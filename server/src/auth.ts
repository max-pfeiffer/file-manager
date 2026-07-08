import { createHash, timingSafeEqual } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

import type { AppConfig, BasicAuthConfig, KeycloakConfig } from "./config.js";

export type AuthHook = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<void>;

const unauthorized = (reply: FastifyReply) =>
  reply.code(401).send({ message: "Unauthorized" });

const sha256 = (value: string): Buffer =>
  createHash("sha256").update(value).digest();

/**
 * HTTP Basic Auth via timing-safe comparison. Hashing both sides first
 * yields equal-length buffers, so the comparison never leaks lengths.
 * No WWW-Authenticate header is sent — the SPA has its own login form
 * and the browser's native prompt must not appear.
 */
export function createBasicAuthHook(basic: BasicAuthConfig): AuthHook {
  const expected = sha256(`${basic.username}:${basic.password}`);
  return async (request, reply) => {
    const header = request.headers.authorization ?? "";
    if (!header.startsWith("Basic ")) {
      return unauthorized(reply);
    }
    const provided = Buffer.from(header.slice(6), "base64").toString("utf8");
    if (!timingSafeEqual(sha256(provided), expected)) {
      return unauthorized(reply);
    }
  };
}

export function keycloakIssuer(keycloak: KeycloakConfig): string {
  return `${keycloak.url.replace(/\/+$/, "")}/realms/${keycloak.realm}`;
}

/**
 * Validates Keycloak Bearer tokens (signature, issuer, expiry) against
 * the realm's JWKS endpoint. `getKey` is injectable for tests.
 */
export function createKeycloakAuthHook(
  keycloak: KeycloakConfig,
  getKey?: JWTVerifyGetKey,
): AuthHook {
  const issuer = keycloakIssuer(keycloak);
  const jwksBase = `${keycloak.internalUrl.replace(/\/+$/, "")}/realms/${keycloak.realm}`;
  const keySource =
    getKey ??
    createRemoteJWKSet(new URL(`${jwksBase}/protocol/openid-connect/certs`));
  return async (request, reply) => {
    const header = request.headers.authorization ?? "";
    if (!header.startsWith("Bearer ")) {
      return unauthorized(reply);
    }
    try {
      await jwtVerify(header.slice(7), keySource, { issuer });
    } catch {
      return unauthorized(reply);
    }
  };
}

/** Returns the hook for the configured auth method, or null for `none`. */
export function createAuthHook(
  config: AppConfig,
  jwtKeySource?: JWTVerifyGetKey,
): AuthHook | null {
  if (config.authMethod === "basic" && config.basicAuth) {
    return createBasicAuthHook(config.basicAuth);
  }
  if (config.authMethod === "keycloak" && config.keycloak) {
    return createKeycloakAuthHook(config.keycloak, jwtKeySource);
  }
  return null;
}
