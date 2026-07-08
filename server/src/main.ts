// Minimal server stub for Phase 0 scaffolding; the real backend
// (config parsing, /api/config, static serving) lands in Phase 1.
import Fastify from "fastify";

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";

const app = Fastify({ logger: true });

app.get("/healthz", async () => ({ status: "ok" }));

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
