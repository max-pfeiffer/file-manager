import { createReadStream, createWriteStream } from "node:fs";
import {
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import multipart from "@fastify/multipart";
import { unzip, zip, type Zippable } from "fflate";
import type { FastifyInstance } from "fastify";

import { Sandbox, SandboxError, validateName } from "../sandbox.js";
import { mimeType } from "../mime.js";
import {
  fsData,
  listEntries,
  toDirEntry,
  walk,
  type DirEntry,
} from "../vfs.js";

export interface FilesRoutesOptions {
  filesRoot: string;
}

interface PathItem {
  path: string;
  type: string;
}

const pathItemSchema = {
  type: "object",
  required: ["path"],
  properties: { path: { type: "string" }, type: { type: "string" } },
} as const;

const zipAsync = (tree: Zippable): Promise<Uint8Array> =>
  new Promise((resolve, reject) =>
    zip(tree, (err, data) => (err ? reject(err) : resolve(data))),
  );

const unzipAsync = (data: Uint8Array): Promise<Record<string, Uint8Array>> =>
  new Promise((resolve, reject) =>
    unzip(data, (err, files) => (err ? reject(err) : resolve(files))),
  );

export async function filesRoutes(
  app: FastifyInstance,
  opts: FilesRoutesOptions,
): Promise<void> {
  const sandbox = await Sandbox.create(opts.filesRoot);

  await app.register(multipart, {
    limits: { fileSize: 1024 * 1024 * 1024 },
  });

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof SandboxError) {
      return reply.code(400).send({ message: err.message });
    }
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return reply.code(404).send({ message: "Not found" });
    }
    if (code === "EEXIST" || code === "ENOTEMPTY") {
      return reply.code(400).send({ message: "Already exists" });
    }
    if (code === "EISDIR" || code === "ENOTDIR") {
      return reply.code(400).send({ message: "Invalid target" });
    }
    const httpError = err as { statusCode?: number; message?: string };
    if (httpError.statusCode && httpError.statusCode < 500) {
      return reply
        .code(httpError.statusCode)
        .send({ message: httpError.message });
    }
    request.log.error(err);
    return reply.code(500).send({ message: "Internal server error" });
  });

  const dirResult = async (vfsDir: string) =>
    fsData(sandbox, await sandbox.resolve(vfsDir));

  /** Resolve a path and require it to be an existing regular file. */
  const resolveFile = async (vfsPath: string) => {
    const abs = await sandbox.resolve(vfsPath);
    const stats = await stat(abs);
    if (!stats.isFile()) {
      throw new SandboxError(`Not a file: ${vfsPath}`);
    }
    return abs;
  };

  /** Compute a transfer target and refuse moving/copying a dir into itself. */
  const transferTarget = async (source: string, destination: string) => {
    const srcAbs = await sandbox.resolve(source);
    const destDirAbs = await sandbox.resolve(destination);
    if (destDirAbs === srcAbs || destDirAbs.startsWith(srcAbs + path.sep)) {
      throw new SandboxError("Cannot transfer a directory into itself");
    }
    const targetAbs = path.join(destDirAbs, path.basename(srcAbs));
    return { srcAbs, targetAbs };
  };

  app.get<{ Querystring: { path?: string } }>(
    "/",
    {
      schema: {
        querystring: {
          type: "object",
          properties: { path: { type: "string" } },
        },
      },
    },
    async (request) => dirResult(request.query.path ?? ""),
  );

  app.post<{ Body: { path: string; name: string } }>(
    "/create-folder",
    {
      schema: {
        body: {
          type: "object",
          required: ["path", "name"],
          properties: { path: { type: "string" }, name: { type: "string" } },
        },
      },
    },
    async (request) => {
      const { path: dir, name } = request.body;
      validateName(name);
      const abs = await sandbox.resolve(sandbox.joinVfs(dir, name));
      await mkdir(abs);
      return dirResult(dir);
    },
  );

  app.post<{ Body: { path: string; name: string } }>(
    "/create-file",
    {
      schema: {
        body: {
          type: "object",
          required: ["path", "name"],
          properties: { path: { type: "string" }, name: { type: "string" } },
        },
      },
    },
    async (request) => {
      const { path: dir, name } = request.body;
      validateName(name);
      const abs = await sandbox.resolve(sandbox.joinVfs(dir, name));
      await writeFile(abs, "", { flag: "wx" });
      return dirResult(dir);
    },
  );

  app.post<{ Body: { path: string; content: string } }>(
    "/save",
    {
      schema: {
        body: {
          type: "object",
          required: ["path", "content"],
          properties: {
            path: { type: "string" },
            content: { type: "string" },
          },
        },
      },
    },
    async (request) => {
      const abs = await sandbox.resolve(request.body.path);
      await writeFile(abs, request.body.content, "utf8");
      return { message: "saved" };
    },
  );

  app.post<{ Body: { path: string; item: string; name: string } }>(
    "/rename",
    {
      schema: {
        body: {
          type: "object",
          required: ["path", "item", "name"],
          properties: {
            path: { type: "string" },
            item: { type: "string" },
            name: { type: "string" },
          },
        },
      },
    },
    async (request) => {
      const { path: dir, item, name } = request.body;
      validateName(name);
      const srcAbs = await sandbox.resolve(item);
      const targetAbs = await sandbox.resolve(
        sandbox.toVfs(path.join(path.dirname(srcAbs), name)),
      );
      await stat(srcAbs); // 404 when the item is gone
      try {
        await stat(targetAbs);
        throw new SandboxError(`"${name}" already exists`);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      await rename(srcAbs, targetAbs);
      return dirResult(dir);
    },
  );

  for (const operation of ["copy", "move"] as const) {
    app.post<{
      Body: { sources: string[]; destination: string; path?: string };
    }>(
      `/${operation}`,
      {
        schema: {
          body: {
            type: "object",
            required: ["sources", "destination"],
            properties: {
              sources: { type: "array", items: { type: "string" } },
              destination: { type: "string" },
              path: { type: "string" },
            },
          },
        },
      },
      async (request) => {
        const { sources, destination } = request.body;
        for (const source of sources) {
          const { srcAbs, targetAbs } = await transferTarget(
            source,
            destination,
          );
          if (srcAbs === targetAbs) continue;
          if (operation === "copy") {
            await cp(srcAbs, targetAbs, {
              recursive: true,
              force: false,
              errorOnExist: true,
            });
          } else {
            await rename(srcAbs, targetAbs);
          }
        }
        return dirResult(request.body.path ?? destination);
      },
    );
  }

  app.post<{ Body: { path: string; items: PathItem[] } }>(
    "/delete",
    {
      schema: {
        body: {
          type: "object",
          required: ["path", "items"],
          properties: {
            path: { type: "string" },
            items: { type: "array", items: pathItemSchema },
          },
        },
      },
    },
    async (request) => {
      const deleted: DirEntry[] = [];
      for (const item of request.body.items) {
        const abs = await sandbox.resolve(item.path);
        if (abs === sandbox.rootPath) {
          throw new SandboxError("Cannot delete the root directory");
        }
        const entry = await toDirEntry(sandbox, abs);
        if (entry) deleted.push(entry);
        await rm(abs, { recursive: true });
      }
      return { ...(await dirResult(request.body.path)), deleted };
    },
  );

  app.post<{
    Body: {
      items: PathItem[];
      path: string;
      name: string;
      destination?: string;
    };
  }>(
    "/archive",
    {
      schema: {
        body: {
          type: "object",
          required: ["items", "path", "name"],
          properties: {
            items: { type: "array", items: pathItemSchema },
            path: { type: "string" },
            name: { type: "string" },
            destination: { type: "string" },
          },
        },
      },
    },
    async (request) => {
      const { items, path: dir, name, destination } = request.body;
      validateName(name);
      const zipName = name.endsWith(".zip") ? name : `${name}.zip`;
      const targetDir = destination ?? dir;
      const zipAbs = await sandbox.resolve(sandbox.joinVfs(targetDir, zipName));

      const tree: Zippable = {};
      for (const item of items) {
        const abs = await sandbox.resolve(item.path);
        const base = path.basename(abs);
        const stats = await stat(abs);
        if (stats.isFile()) {
          tree[base] = await readFile(abs);
        } else {
          for await (const child of walk(abs)) {
            const rel = `${base}/${path.relative(abs, child).split(path.sep).join("/")}`;
            const childStats = await stat(child);
            if (childStats.isFile()) {
              tree[rel] = await readFile(child);
            }
          }
        }
      }

      await writeFile(zipAbs, await zipAsync(tree), { flag: "wx" });
      return dirResult(dir);
    },
  );

  app.post<{ Body: { item: string; path: string; destination?: string } }>(
    "/unarchive",
    {
      schema: {
        body: {
          type: "object",
          required: ["item", "path"],
          properties: {
            item: { type: "string" },
            path: { type: "string" },
            destination: { type: "string" },
          },
        },
      },
    },
    async (request) => {
      const { item, path: dir, destination } = request.body;
      const zipAbs = await resolveFile(item);
      const targetDir = destination ?? dir;
      await sandbox.resolve(targetDir);

      const entries = await unzipAsync(new Uint8Array(await readFile(zipAbs)));
      for (const [entryName, data] of Object.entries(entries)) {
        // Zip-slip guard: no absolute entry names, no `..` segments.
        if (
          path.posix.isAbsolute(entryName) ||
          entryName.split("/").includes("..") ||
          entryName.includes("\0")
        ) {
          throw new SandboxError(`Unsafe archive entry: ${entryName}`);
        }
        const abs = await sandbox.resolve(
          sandbox.joinVfs(targetDir, entryName),
        );
        if (entryName.endsWith("/")) {
          await mkdir(abs, { recursive: true });
        } else {
          await mkdir(path.dirname(abs), { recursive: true });
          await writeFile(abs, data);
        }
      }
      return dirResult(dir);
    },
  );

  app.get<{
    Querystring: {
      path?: string;
      filter?: string;
      deep?: string;
      size?: string;
    };
  }>(
    "/search",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            path: { type: "string" },
            filter: { type: "string" },
            deep: { type: "string" },
            size: { type: "string" },
          },
        },
      },
    },
    async (request) => {
      const { path: dir = "", filter = "", deep, size } = request.query;
      const baseAbs = await sandbox.resolve(dir);
      const needle = filter.toLowerCase();

      let candidates: DirEntry[];
      if (deep === "1" || deep === "true") {
        candidates = [];
        for await (const abs of walk(baseAbs)) {
          const entry = await toDirEntry(sandbox, abs);
          if (entry) candidates.push(entry);
        }
      } else {
        candidates = await listEntries(sandbox, baseAbs);
      }

      const matchesSize = (entry: DirEntry) => {
        if (!size || size === "all" || entry.type === "dir") return true;
        const bytes = entry.file_size ?? 0;
        if (size === "small") return bytes < 1024 * 1024;
        if (size === "medium") return bytes <= 100 * 1024 * 1024;
        return bytes > 100 * 1024 * 1024;
      };

      const files = candidates.filter(
        (entry) =>
          entry.basename.toLowerCase().includes(needle) && matchesSize(entry),
      );
      return {
        storages: [sandbox.storage],
        dirname: sandbox.toVfs(baseAbs),
        files,
        read_only: false,
      };
    },
  );

  app.get<{ Querystring: { path: string } }>(
    "/preview",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["path"],
          properties: { path: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const abs = await resolveFile(request.query.path);
      return reply
        .type(mimeType(path.basename(abs)))
        .send(createReadStream(abs));
    },
  );

  app.get<{ Querystring: { path: string } }>(
    "/download",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["path"],
          properties: { path: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const abs = await resolveFile(request.query.path);
      const filename = encodeURIComponent(path.basename(abs));
      return reply
        .type(mimeType(path.basename(abs)))
        .header(
          "content-disposition",
          `attachment; filename*=UTF-8''${filename}`,
        )
        .send(createReadStream(abs));
    },
  );

  app.post("/upload", async (request) => {
    let targetDir: string | undefined;
    let uploaded = false;
    for await (const part of request.parts()) {
      if (part.type === "field" && part.fieldname === "path") {
        targetDir = String(part.value);
      } else if (part.type === "file") {
        if (part.fieldname !== "file" || targetDir === undefined) {
          throw new SandboxError(
            "Upload requires a path field before the file",
          );
        }
        const name = validateName(path.basename(part.filename));
        const abs = await sandbox.resolve(sandbox.joinVfs(targetDir, name));
        await pipeline(part.file, createWriteStream(abs));
        uploaded = true;
      }
    }
    if (!uploaded) {
      throw new SandboxError("No file in upload request");
    }
    return dirResult(targetDir ?? "");
  });
}
