import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { zipSync, strToU8 } from "fflate";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import type { FsData, DirEntry } from "../vfs.js";

let root: string;
let app: FastifyInstance;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "files-api-"));
  app = buildApp({
    port: 8080,
    host: "0.0.0.0",
    filesRoot: root,
    authMethod: "none",
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

const post = (url: string, payload: unknown) =>
  app.inject({ method: "POST", url, payload });

const exists = (...segments: string[]) =>
  access(path.join(root, ...segments)).then(
    () => true,
    () => false,
  );

const basenames = (data: FsData) => data.files.map((f) => f.basename);

describe("GET /api (index)", () => {
  it("lists an empty root", async () => {
    const response = await app.inject({ method: "GET", url: "/api" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      storages: ["local"],
      dirname: "local://",
      files: [],
      read_only: false,
    });
  });

  it("lists entries with directories first", async () => {
    await writeFile(path.join(root, "b.txt"), "hello");
    await mkdir(path.join(root, "a-dir"));
    const response = await app.inject({
      method: "GET",
      url: "/api?path=local://",
    });
    const data = response.json<FsData>();
    expect(basenames(data)).toEqual(["a-dir", "b.txt"]);
    const file = data.files[1];
    expect(file).toMatchObject({
      dir: "local://",
      path: "local://b.txt",
      type: "file",
      extension: "txt",
      file_size: 5,
      mime_type: "text/plain",
      storage: "local",
    });
  });

  it("rejects traversal outside the root", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api?path=${encodeURIComponent("local://../")}`,
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("POST /api/create-folder and /api/create-file", () => {
  it("creates a folder and returns the listing", async () => {
    const response = await post("/api/create-folder", {
      path: "local://",
      name: "docs",
    });
    expect(response.statusCode).toBe(200);
    expect(basenames(response.json<FsData>())).toContain("docs");
    expect(await exists("docs")).toBe(true);
  });

  it("creates an empty file", async () => {
    const response = await post("/api/create-file", {
      path: "local://",
      name: "notes.txt",
    });
    expect(response.statusCode).toBe(200);
    expect(await readFile(path.join(root, "notes.txt"), "utf8")).toBe("");
  });

  it("rejects duplicates", async () => {
    await mkdir(path.join(root, "docs"));
    const response = await post("/api/create-folder", {
      path: "local://",
      name: "docs",
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects names containing path separators", async () => {
    const response = await post("/api/create-file", {
      path: "local://",
      name: "../evil.txt",
    });
    expect(response.statusCode).toBe(400);
    expect(await exists("..", "evil.txt")).toBe(false);
  });
});

describe("POST /api/save and GET /api/preview", () => {
  it("saves and previews text content", async () => {
    await writeFile(path.join(root, "a.md"), "");
    const saveResponse = await post("/api/save", {
      path: "local://a.md",
      content: "# Hello",
    });
    expect(saveResponse.statusCode).toBe(200);

    const preview = await app.inject({
      method: "GET",
      url: `/api/preview?path=${encodeURIComponent("local://a.md")}`,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.body).toBe("# Hello");
    expect(preview.headers["content-type"]).toContain("text/markdown");
  });

  it("rejects previewing a directory", async () => {
    await mkdir(path.join(root, "docs"));
    const response = await app.inject({
      method: "GET",
      url: `/api/preview?path=${encodeURIComponent("local://docs")}`,
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects preview paths escaping the root", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/preview?path=${encodeURIComponent("local://../../etc/passwd")}`,
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("GET /api/download", () => {
  it("sends the file as an attachment", async () => {
    await writeFile(path.join(root, "report.txt"), "data");
    const response = await app.inject({
      method: "GET",
      url: `/api/download?path=${encodeURIComponent("local://report.txt")}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("data");
    expect(response.headers["content-disposition"]).toContain("attachment");
    expect(response.headers["content-disposition"]).toContain("report.txt");
  });
});

describe("POST /api/rename", () => {
  it("renames a file", async () => {
    await writeFile(path.join(root, "old.txt"), "x");
    const response = await post("/api/rename", {
      path: "local://",
      item: "local://old.txt",
      name: "new.txt",
    });
    expect(response.statusCode).toBe(200);
    expect(await exists("old.txt")).toBe(false);
    expect(await exists("new.txt")).toBe(true);
  });

  it("refuses to overwrite an existing entry", async () => {
    await writeFile(path.join(root, "a.txt"), "a");
    await writeFile(path.join(root, "b.txt"), "b");
    const response = await post("/api/rename", {
      path: "local://",
      item: "local://a.txt",
      name: "b.txt",
    });
    expect(response.statusCode).toBe(400);
    expect(await readFile(path.join(root, "b.txt"), "utf8")).toBe("b");
  });

  it("rejects renaming to a name with separators", async () => {
    await writeFile(path.join(root, "a.txt"), "a");
    const response = await post("/api/rename", {
      path: "local://",
      item: "local://a.txt",
      name: "../escape.txt",
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("POST /api/copy and /api/move", () => {
  beforeEach(async () => {
    await mkdir(path.join(root, "src-dir", "nested"), { recursive: true });
    await writeFile(path.join(root, "src-dir", "nested", "deep.txt"), "deep");
    await writeFile(path.join(root, "file.txt"), "content");
    await mkdir(path.join(root, "dest"));
  });

  it("copies files and directories recursively", async () => {
    const response = await post("/api/copy", {
      sources: ["local://file.txt", "local://src-dir"],
      destination: "local://dest",
      path: "local://",
    });
    expect(response.statusCode).toBe(200);
    expect(await exists("dest", "file.txt")).toBe(true);
    expect(await exists("dest", "src-dir", "nested", "deep.txt")).toBe(true);
    expect(await exists("file.txt")).toBe(true); // source kept
  });

  it("moves entries", async () => {
    const response = await post("/api/move", {
      sources: ["local://file.txt"],
      destination: "local://dest",
      path: "local://",
    });
    expect(response.statusCode).toBe(200);
    expect(await exists("file.txt")).toBe(false);
    expect(await exists("dest", "file.txt")).toBe(true);
  });

  it("refuses to move a directory into itself", async () => {
    const response = await post("/api/move", {
      sources: ["local://src-dir"],
      destination: "local://src-dir/nested",
      path: "local://",
    });
    expect(response.statusCode).toBe(400);
    expect(await exists("src-dir", "nested", "deep.txt")).toBe(true);
  });
});

describe("POST /api/delete", () => {
  it("deletes files and directories and reports them", async () => {
    await writeFile(path.join(root, "a.txt"), "a");
    await mkdir(path.join(root, "dir"));
    await writeFile(path.join(root, "dir", "b.txt"), "b");
    const response = await post("/api/delete", {
      path: "local://",
      items: [
        { path: "local://a.txt", type: "file" },
        { path: "local://dir", type: "dir" },
      ],
    });
    expect(response.statusCode).toBe(200);
    const data = response.json<FsData & { deleted: DirEntry[] }>();
    expect(data.files).toEqual([]);
    expect(data.deleted.map((d) => d.basename)).toEqual(["a.txt", "dir"]);
    expect(await exists("a.txt")).toBe(false);
    expect(await exists("dir")).toBe(false);
  });

  it("refuses to delete the root", async () => {
    const response = await post("/api/delete", {
      path: "local://",
      items: [{ path: "local://", type: "dir" }],
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("GET /api/search", () => {
  beforeEach(async () => {
    await mkdir(path.join(root, "a", "b"), { recursive: true });
    await writeFile(path.join(root, "needle.txt"), "x");
    await writeFile(path.join(root, "a", "b", "deep-needle.txt"), "x");
    await writeFile(path.join(root, "other.md"), "x");
  });

  it("searches the current directory by default", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/search?filter=needle",
    });
    const data = response.json<FsData>();
    expect(basenames(data)).toEqual(["needle.txt"]);
  });

  it("searches recursively with deep=1", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/search?filter=needle&deep=1",
    });
    const data = response.json<FsData>();
    expect(basenames(data).sort()).toEqual(["deep-needle.txt", "needle.txt"]);
  });
});

describe("POST /api/archive and /api/unarchive", () => {
  beforeEach(async () => {
    await mkdir(path.join(root, "project", "sub"), { recursive: true });
    await writeFile(path.join(root, "project", "readme.md"), "# readme");
    await writeFile(path.join(root, "project", "sub", "code.ts"), "let x=1;");
    await writeFile(path.join(root, "loose.txt"), "loose");
    await mkdir(path.join(root, "extracted"));
  });

  it("round-trips a zip archive", async () => {
    const archiveResponse = await post("/api/archive", {
      items: [
        { path: "local://project", type: "dir" },
        { path: "local://loose.txt", type: "file" },
      ],
      path: "local://",
      name: "bundle",
    });
    expect(archiveResponse.statusCode).toBe(200);
    expect(await exists("bundle.zip")).toBe(true);

    const unarchiveResponse = await post("/api/unarchive", {
      item: "local://bundle.zip",
      path: "local://",
      destination: "local://extracted",
    });
    expect(unarchiveResponse.statusCode).toBe(200);
    expect(
      await readFile(path.join(root, "extracted", "loose.txt"), "utf8"),
    ).toBe("loose");
    expect(
      await readFile(
        path.join(root, "extracted", "project", "sub", "code.ts"),
        "utf8",
      ),
    ).toBe("let x=1;");
  });

  it("refuses to overwrite an existing archive", async () => {
    await writeFile(path.join(root, "bundle.zip"), "existing");
    const response = await post("/api/archive", {
      items: [{ path: "local://loose.txt", type: "file" }],
      path: "local://",
      name: "bundle",
    });
    expect(response.statusCode).toBe(400);
    expect(await readFile(path.join(root, "bundle.zip"), "utf8")).toBe(
      "existing",
    );
  });

  it("blocks zip-slip entries on unarchive", async () => {
    const malicious = zipSync({ "../evil.txt": strToU8("pwned") });
    await writeFile(path.join(root, "evil.zip"), malicious);
    const response = await post("/api/unarchive", {
      item: "local://evil.zip",
      path: "local://",
      destination: "local://extracted",
    });
    expect(response.statusCode).toBe(400);
    expect(await exists("evil.txt")).toBe(false);
    expect(await exists("..", "evil.txt")).toBe(false);
  });
});

describe("POST /api/upload", () => {
  it("stores an uploaded file in the target directory", async () => {
    await mkdir(path.join(root, "uploads"));
    const boundary = "----vitest-boundary";
    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="path"',
      "",
      "local://uploads",
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="hello.txt"',
      "Content-Type: text/plain",
      "",
      "hello upload",
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const response = await app.inject({
      method: "POST",
      url: "/api/upload",
      payload,
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(
      await readFile(path.join(root, "uploads", "hello.txt"), "utf8"),
    ).toBe("hello upload");
  });
});
