import { fileURLToPath } from "node:url";

import { buildApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`Configuration error: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

// Resolves to dist/web next to the built server (dist/server); in
// development this path does not exist and Vite serves the SPA instead.
const webRoot = fileURLToPath(new URL("../web", import.meta.url));

const app = buildApp(config, { logger: true, webRoot });

app.listen({ port: config.port, host: config.host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
