import { existsSync } from "node:fs";

import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

import type { AppConfig } from "./config.js";

export interface BuildAppOptions {
  logger?: boolean;
  /**
   * Directory holding the built SPA (dist/web). When absent or missing
   * (development — Vite serves the SPA), static serving is skipped.
   */
  webRoot?: string;
}

export function buildApp(
  config: AppConfig,
  opts: BuildAppOptions = {},
): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });

  app.get("/healthz", async () => ({ status: "ok" }));

  // Runtime configuration for the frontend. Basic Auth credentials must
  // never be exposed here.
  app.get("/api/config", async () => ({
    authMethod: config.authMethod,
    ...(config.keycloak ? { keycloak: config.keycloak } : {}),
  }));

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
