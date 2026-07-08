import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Sandbox, SandboxError, validateName } from "./sandbox.js";

let base: string;
let root: string;
let outside: string;
let sandbox: Sandbox;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "sandbox-"));
  root = path.join(base, "root");
  outside = path.join(base, "outside");
  await mkdir(outside);
  await writeFile(path.join(base, "secret.txt"), "secret");
  sandbox = await Sandbox.create(root);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("Sandbox.create", () => {
  it("creates the root directory if missing", async () => {
    expect(await sandbox.resolve("local://")).toBe(sandbox.rootPath);
  });
});

describe("resolve", () => {
  it("resolves the storage root", async () => {
    expect(await sandbox.resolve("local://")).toBe(sandbox.rootPath);
    expect(await sandbox.resolve("")).toBe(sandbox.rootPath);
  });

  it("resolves nested paths that do not exist yet", async () => {
    expect(await sandbox.resolve("local://sub/new.txt")).toBe(
      path.join(sandbox.rootPath, "sub", "new.txt"),
    );
  });

  it("accepts paths without a storage prefix", async () => {
    expect(await sandbox.resolve("sub/file.txt")).toBe(
      path.join(sandbox.rootPath, "sub", "file.txt"),
    );
  });

  it("rejects other storages", async () => {
    await expect(sandbox.resolve("s3://file.txt")).rejects.toThrow(
      SandboxError,
    );
  });

  it("rejects null bytes", async () => {
    await expect(sandbox.resolve("local://a\0b")).rejects.toThrow(SandboxError);
  });

  describe("`..` traversal", () => {
    it.each([
      "local://../secret.txt",
      "local://..",
      "local://sub/../../secret.txt",
      "local://sub/../../../etc/passwd",
      "../secret.txt",
    ])("rejects %s", async (vfsPath) => {
      await expect(sandbox.resolve(vfsPath)).rejects.toThrow(
        /escapes the files root/,
      );
    });

    it("allows `..` that stays inside the root", async () => {
      expect(await sandbox.resolve("local://sub/../other")).toBe(
        path.join(sandbox.rootPath, "other"),
      );
    });
  });

  describe("absolute paths", () => {
    it.each(["local:///etc/passwd", "/etc/passwd"])(
      "rejects %s",
      async (vfsPath) => {
        await expect(sandbox.resolve(vfsPath)).rejects.toThrow(
          /Absolute paths/,
        );
      },
    );
  });

  describe("symlink escapes", () => {
    it("rejects a symlinked directory pointing outside the root", async () => {
      await symlink(outside, path.join(root, "link"));
      await expect(sandbox.resolve("local://link")).rejects.toThrow(
        /escapes the files root/,
      );
      await expect(sandbox.resolve("local://link/file.txt")).rejects.toThrow(
        /escapes the files root/,
      );
    });

    it("rejects a symlinked file pointing outside the root", async () => {
      await symlink(
        path.join(base, "secret.txt"),
        path.join(root, "innocent.txt"),
      );
      await expect(sandbox.resolve("local://innocent.txt")).rejects.toThrow(
        /escapes the files root/,
      );
    });

    it("rejects paths under a symlinked ancestor even for missing files", async () => {
      await symlink(outside, path.join(root, "link"));
      await expect(
        sandbox.resolve("local://link/sub/created-later.txt"),
      ).rejects.toThrow(/escapes the files root/);
    });

    it("allows symlinks that stay inside the root", async () => {
      await mkdir(path.join(root, "real"));
      await symlink(path.join(root, "real"), path.join(root, "alias"));
      expect(await sandbox.resolve("local://alias/file.txt")).toBe(
        path.join(sandbox.rootPath, "alias", "file.txt"),
      );
    });
  });
});

describe("toVfs / joinVfs", () => {
  it("round-trips paths", async () => {
    const abs = await sandbox.resolve("local://sub/file.txt");
    expect(sandbox.toVfs(abs)).toBe("local://sub/file.txt");
    expect(sandbox.toVfs(sandbox.rootPath)).toBe("local://");
  });

  it("joins directory paths and names", () => {
    expect(sandbox.joinVfs("local://", "a.txt")).toBe("local://a.txt");
    expect(sandbox.joinVfs("local://sub", "a.txt")).toBe("local://sub/a.txt");
    expect(sandbox.joinVfs("", "a.txt")).toBe("local://a.txt");
  });
});

describe("validateName", () => {
  it.each(["", ".", "..", "a/b", "a\\b", "a\0b"])("rejects %j", (name) => {
    expect(() => validateName(name)).toThrow(SandboxError);
  });

  it("accepts regular names", () => {
    expect(validateName("report final (2).txt")).toBe("report final (2).txt");
  });
});
