import { existsSync } from "node:fs";

import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import type { JWTVerifyGetKey } from "jose";

import { createAuthHook } from "./auth.js";
import type { AppConfig } from "./config.js";
import { filesRoutes } from "./routes/files.js";

export interface BuildAppOptions {
  logger?: boolean;
  /**
   * Directory holding the built SPA (dist/web). When absent or missing
   * (development — Vite serves the SPA), static serving is skipped.
   */
  webRoot?: string;
  /** Test-only override for the Keycloak JWKS key source. */
  jwtKeySource?: JWTVerifyGetKey;
}

export function buildApp(
  config: AppConfig,
  opts: BuildAppOptions = {},
): FastifyInstance {
  // bodyLimit covers JSON saves of edited text files; uploads stream
  // through multipart and are limited separately in the files routes.
  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 32 * 1024 * 1024,
  });

  app.get("/healthz", async () => ({ status: "ok" }));

  // Runtime configuration for the frontend. Deliberately unauthenticated:
  // the SPA needs it to know how to authenticate. Basic Auth credentials
  // must never be exposed here.
  app.get("/api/config", async () => ({
    authMethod: config.authMethod,
    ...(config.keycloak ? { keycloak: config.keycloak } : {}),
  }));

  // The file API is guarded by the configured auth method; /healthz and
  // /api/config above stay open.
  app.register(
    async (api) => {
      const authHook = createAuthHook(config, opts.jwtKeySource);
      if (authHook) {
        api.addHook("onRequest", authHook);
      }
      await api.register(filesRoutes, { filesRoot: config.filesRoot });
    },
    { prefix: "/api" },
  );

  if (opts.webRoot && existsSync(opts.webRoot)) {
    app.register(fastifyStatic, { root: opts.webRoot });

    // SPA fallback: unknown GET routes outside /api serve index.html so
    // client-side routing works on hard reloads.
    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api/")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "Not Found" });
    });
  }

  return app;
}
