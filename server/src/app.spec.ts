import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import type { AppConfig } from "./config.js";

// The files routes create a sandbox for filesRoot on registration, so
// tests need a root that actually exists and is writable.
let filesRoot: string;
let baseConfig: AppConfig;

beforeAll(async () => {
  filesRoot = await mkdtemp(path.join(tmpdir(), "app-spec-root-"));
  baseConfig = {
    port: 8080,
    host: "0.0.0.0",
    filesRoot,
    authMethod: "none",
  };
});

afterAll(async () => {
  await rm(filesRoot, { recursive: true, force: true });
});

describe("GET /healthz", () => {
  it("returns 200 ok", async () => {
    const app = buildApp(baseConfig);
    const response = await app.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});

describe("GET /api/config", () => {
  it("returns the auth method", async () => {
    const app = buildApp(baseConfig);
    const response = await app.inject({ method: "GET", url: "/api/config" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ authMethod: "none" });
  });

  it("returns Keycloak settings when configured", async () => {
    const app = buildApp({
      ...baseConfig,
      authMethod: "keycloak",
      keycloak: {
        url: "http://keycloak:8080",
        realm: "file-manager",
        clientId: "file-manager",
      },
    });
    const response = await app.inject({ method: "GET", url: "/api/config" });
    expect(response.json()).toEqual({
      authMethod: "keycloak",
      keycloak: {
        url: "http://keycloak:8080",
        realm: "file-manager",
        clientId: "file-manager",
      },
    });
  });

  it("never exposes Basic Auth credentials", async () => {
    const app = buildApp({
      ...baseConfig,
      authMethod: "basic",
      basicAuth: { username: "admin", password: "secret" },
    });
    const response = await app.inject({ method: "GET", url: "/api/config" });
    expect(response.json()).toEqual({ authMethod: "basic" });
    expect(response.body).not.toContain("admin");
    expect(response.body).not.toContain("secret");
  });
});

describe("static SPA serving", () => {
  let webRoot: string;

  afterEach(async () => {
    await rm(webRoot, { recursive: true, force: true });
  });

  async function createWebRoot(): Promise<string> {
    webRoot = await mkdtemp(path.join(tmpdir(), "file-manager-web-"));
    await writeFile(path.join(webRoot, "index.html"), "<html>spa</html>");
    return webRoot;
  }

  it("serves index.html at the root", async () => {
    const app = buildApp(baseConfig, { webRoot: await createWebRoot() });
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("<html>spa</html>");
  });

  it("falls back to index.html for client-side routes", async () => {
    const app = buildApp(baseConfig, { webRoot: await createWebRoot() });
    const response = await app.inject({ method: "GET", url: "/some/route" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("<html>spa</html>");
  });

  it("does not swallow unknown API routes", async () => {
    const app = buildApp(baseConfig, { webRoot: await createWebRoot() });
    const response = await app.inject({ method: "GET", url: "/api/nope" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Not Found" });
  });
});
