import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";

export class SandboxError extends Error {}

const STORAGE_PREFIX = /^([a-z0-9_-]+):\/\//i;

/** Reject file/folder names that could change the target directory. */
export function validateName(name: string): string {
  if (
    !name ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0")
  ) {
    throw new SandboxError(`Invalid name "${name}"`);
  }
  return name;
}

/**
 * Maps VueFinder paths ("local://sub/dir") to absolute filesystem paths,
 * rejecting anything that escapes the configured root — via `..` segments,
 * absolute paths or symlinks pointing outside the root.
 */
export class Sandbox {
  private constructor(
    readonly storage: string,
    private readonly root: string,
  ) {}

  /** Creates the root directory if missing and resolves its real path. */
  static async create(root: string, storage = "local"): Promise<Sandbox> {
    await mkdir(root, { recursive: true });
    return new Sandbox(storage, await realpath(root));
  }

  get rootPath(): string {
    return this.root;
  }

  get rootVfs(): string {
    return `${this.storage}://`;
  }

  /** Converts an absolute filesystem path back to a VueFinder path. */
  toVfs(abs: string): string {
    const rel = path.relative(this.root, abs);
    return `${this.storage}://${rel.split(path.sep).join("/")}`;
  }

  /** Joins a VueFinder directory path and an entry name. */
  joinVfs(dir: string, name: string): string {
    const base = dir || this.rootVfs;
    return base.endsWith("://") || base.endsWith("/")
      ? `${base}${name}`
      : `${base}/${name}`;
  }

  /**
   * Resolves a VueFinder path to an absolute filesystem path inside the
   * root. The path itself does not need to exist (creation targets), but
   * every existing part of it must really live inside the root once
   * symlinks are resolved.
   */
  async resolve(vfsPath: string): Promise<string> {
    if (vfsPath.includes("\0")) {
      throw new SandboxError("Invalid path");
    }

    const match = STORAGE_PREFIX.exec(vfsPath);
    let rel = vfsPath;
    if (match) {
      if (match[1] !== this.storage) {
        throw new SandboxError(`Unknown storage "${match[1]}"`);
      }
      rel = vfsPath.slice(match[0].length);
    }
    if (path.isAbsolute(rel)) {
      throw new SandboxError(`Absolute paths are not allowed: ${vfsPath}`);
    }

    const abs = path.resolve(this.root, rel);
    this.assertInsideRoot(abs, vfsPath);

    // Symlink guard: resolve the deepest existing ancestor and re-check
    // where the requested path would actually end up on disk.
    let probe = abs;
    for (;;) {
      let real: string;
      try {
        real = await realpath(probe);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          const parent = path.dirname(probe);
          if (parent === probe) {
            throw new SandboxError(`Path escapes the files root: ${vfsPath}`);
          }
          probe = parent;
          continue;
        }
        throw err;
      }
      const effective =
        probe === abs ? real : path.join(real, path.relative(probe, abs));
      this.assertInsideRoot(effective, vfsPath);
      return abs;
    }
  }

  private assertInsideRoot(abs: string, vfsPath: string): void {
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) {
      throw new SandboxError(`Path escapes the files root: ${vfsPath}`);
    }
  }
}
