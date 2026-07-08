import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey,
} from "jose";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import { keycloakIssuer } from "./auth.js";
import type { AppConfig } from "./config.js";

let filesRoot: string;

beforeAll(async () => {
  filesRoot = await mkdtemp(path.join(tmpdir(), "auth-spec-root-"));
});

afterAll(async () => {
  await rm(filesRoot, { recursive: true, force: true });
});

const basicConfig = (): AppConfig => ({
  port: 8080,
  host: "0.0.0.0",
  filesRoot,
  authMethod: "basic",
  basicAuth: { username: "admin", password: "secret" },
});

const keycloakSettings = {
  url: "http://keycloak:8080",
  realm: "file-manager",
  clientId: "file-manager",
  internalUrl: "http://keycloak:8080",
};

const keycloakConfig = (): AppConfig => ({
  port: 8080,
  host: "0.0.0.0",
  filesRoot,
  authMethod: "keycloak",
  keycloak: keycloakSettings,
});

const basicHeader = (username: string, password: string) =>
  `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

describe("basic auth", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it("rejects file API requests without credentials", async () => {
    app = buildApp(basicConfig());
    const response = await app.inject({ method: "GET", url: "/api" });
    expect(response.statusCode).toBe(401);
    expect(response.headers["www-authenticate"]).toBeUndefined();
  });

  it("rejects wrong credentials", async () => {
    app = buildApp(basicConfig());
    const response = await app.inject({
      method: "GET",
      url: "/api",
      headers: { authorization: basicHeader("admin", "wrong") },
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects malformed authorization headers", async () => {
    app = buildApp(basicConfig());
    const response = await app.inject({
      method: "GET",
      url: "/api",
      headers: { authorization: "Bearer whatever" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("accepts correct credentials", async () => {
    app = buildApp(basicConfig());
    const response = await app.inject({
      method: "GET",
      url: "/api",
      headers: { authorization: basicHeader("admin", "secret") },
    });
    expect(response.statusCode).toBe(200);
  });

  it("keeps /healthz and /api/config open", async () => {
    app = buildApp(basicConfig());
    const health = await app.inject({ method: "GET", url: "/healthz" });
    expect(health.statusCode).toBe(200);
    const config = await app.inject({ method: "GET", url: "/api/config" });
    expect(config.statusCode).toBe(200);
    expect(config.json()).toEqual({ authMethod: "basic" });
  });
});

describe("keycloak auth", () => {
  let app: FastifyInstance;
  let getKey: JWTVerifyGetKey;
  let signKey: CryptoKey;
  const issuer = keycloakIssuer(keycloakSettings);

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    signKey = privateKey as CryptoKey;
    getKey = createLocalJWKSet({
      keys: [{ ...(await exportJWK(publicKey)), alg: "RS256", use: "sig" }],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  const token = (claims: { issuer?: string; expired?: boolean } = {}) =>
    new SignJWT({ preferred_username: "test" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(claims.issuer ?? issuer)
      .setSubject("user-1")
      .setIssuedAt(claims.expired ? "-2h" : undefined)
      .setExpirationTime(claims.expired ? "-1h" : "5m")
      .sign(signKey);

  it("rejects requests without a bearer token", async () => {
    app = buildApp(keycloakConfig(), { jwtKeySource: getKey });
    const response = await app.inject({ method: "GET", url: "/api" });
    expect(response.statusCode).toBe(401);
  });

  it("rejects garbage tokens", async () => {
    app = buildApp(keycloakConfig(), { jwtKeySource: getKey });
    const response = await app.inject({
      method: "GET",
      url: "/api",
      headers: { authorization: "Bearer not-a-jwt" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects expired tokens", async () => {
    app = buildApp(keycloakConfig(), { jwtKeySource: getKey });
    const response = await app.inject({
      method: "GET",
      url: "/api",
      headers: { authorization: `Bearer ${await token({ expired: true })}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects tokens from another issuer", async () => {
    app = buildApp(keycloakConfig(), { jwtKeySource: getKey });
    const response = await app.inject({
      method: "GET",
      url: "/api",
      headers: {
        authorization: `Bearer ${await token({ issuer: "http://evil/realms/x" })}`,
      },
    });
    expect(response.statusCode).toBe(401);
  });

  it("accepts valid tokens", async () => {
    app = buildApp(keycloakConfig(), { jwtKeySource: getKey });
    const response = await app.inject({
      method: "GET",
      url: "/api",
      headers: { authorization: `Bearer ${await token()}` },
    });
    expect(response.statusCode).toBe(200);
  });

  it("exposes the Keycloak settings on /api/config without auth", async () => {
    app = buildApp(keycloakConfig(), { jwtKeySource: getKey });
    const response = await app.inject({ method: "GET", url: "/api/config" });
    expect(response.statusCode).toBe(200);
    // internalUrl is backend-only and must not leak to the frontend.
    expect(response.json()).toEqual({
      authMethod: "keycloak",
      keycloak: {
        url: keycloakSettings.url,
        realm: keycloakSettings.realm,
        clientId: keycloakSettings.clientId,
      },
    });
  });
});

describe("no auth", () => {
  it("leaves the file API open", async () => {
    const app = buildApp({
      port: 8080,
      host: "0.0.0.0",
      filesRoot,
      authMethod: "none",
    });
    const response = await app.inject({ method: "GET", url: "/api" });
    expect(response.statusCode).toBe(200);
    await app.close();
  });
});
