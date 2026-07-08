import { fileURLToPath, URL } from "node:url";

import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: {
          name: "web",
          include: ["src/**/*.spec.ts"],
          environment: "jsdom",
        },
      },
      {
        extends: true,
        test: {
          name: "server",
          include: ["server/src/**/*.spec.ts"],
          environment: "node",
        },
      },
    ],
  },
});
