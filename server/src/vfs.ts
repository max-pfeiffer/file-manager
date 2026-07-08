import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { mimeType } from "./mime.js";
import type { Sandbox } from "./sandbox.js";

/** Directory entry as expected by VueFinder's RemoteDriver. */
export interface DirEntry {
  dir: string;
  basename: string;
  extension: string;
  path: string;
  storage: string;
  type: "file" | "dir";
  file_size: number | null;
  last_modified: number | null;
  mime_type: string | null;
  visibility: string;
}

/** Listing payload (FsData / FileOperationResult) for VueFinder. */
export interface FsData {
  storages: string[];
  dirname: string;
  files: DirEntry[];
  read_only: boolean;
}

export async function toDirEntry(
  sandbox: Sandbox,
  abs: string,
): Promise<DirEntry | null> {
  let stats;
  try {
    stats = await stat(abs);
  } catch {
    return null; // broken symlink or vanished entry — skip
  }
  const basename = path.basename(abs);
  const isDir = stats.isDirectory();
  const dot = basename.lastIndexOf(".");
  return {
    dir: sandbox.toVfs(path.dirname(abs)),
    basename,
    extension: !isDir && dot > 0 ? basename.slice(dot + 1) : "",
    path: sandbox.toVfs(abs),
    storage: sandbox.storage,
    type: isDir ? "dir" : "file",
    file_size: isDir ? null : stats.size,
    last_modified: Math.floor(stats.mtimeMs / 1000),
    mime_type: isDir ? null : mimeType(basename),
    visibility: "public",
  };
}

export async function listEntries(
  sandbox: Sandbox,
  absDir: string,
): Promise<DirEntry[]> {
  const names = await readdir(absDir);
  const entries = await Promise.all(
    names.map((name) => toDirEntry(sandbox, path.join(absDir, name))),
  );
  return entries
    .filter((entry): entry is DirEntry => entry !== null)
    .sort((a, b) =>
      a.type === b.type
        ? a.basename.localeCompare(b.basename)
        : a.type === "dir"
          ? -1
          : 1,
    );
}

export async function fsData(
  sandbox: Sandbox,
  absDir: string,
): Promise<FsData> {
  return {
    storages: [sandbox.storage],
    dirname: sandbox.toVfs(absDir),
    files: await listEntries(sandbox, absDir),
    read_only: false,
  };
}

/** Recursively yields all absolute paths below a directory. */
export async function* walk(absDir: string): AsyncGenerator<string> {
  const entries = await readdir(absDir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(absDir, entry.name);
    yield abs;
    if (entry.isDirectory()) {
      yield* walk(abs);
    }
  }
}
