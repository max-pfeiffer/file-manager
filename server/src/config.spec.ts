import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("applies defaults for an empty environment", () => {
    expect(loadConfig({})).toEqual({
      port: 8080,
      host: "0.0.0.0",
      filesRoot: "/data",
      authMethod: "none",
    });
  });

  it("reads PORT, HOST and FILES_ROOT from the environment", () => {
    const config = loadConfig({
      PORT: "3000",
      HOST: "127.0.0.1",
      FILES_ROOT: "/srv/files",
    });
    expect(config.port).toBe(3000);
    expect(config.host).toBe("127.0.0.1");
    expect(config.filesRoot).toBe("/srv/files");
  });

  it.each(["abc", "0", "70000", "80.5"])("rejects invalid PORT %s", (PORT) => {
    expect(() => loadConfig({ PORT })).toThrow(ConfigError);
  });

  it("rejects an unknown AUTH_METHOD", () => {
    expect(() => loadConfig({ AUTH_METHOD: "oauth" })).toThrow(ConfigError);
    expect(() => loadConfig({ AUTH_METHOD: "oauth" })).toThrow(/AUTH_METHOD/);
  });

  describe("AUTH_METHOD=basic", () => {
    it("requires AUTH_USERNAME and AUTH_PASSWORD", () => {
      expect(() => loadConfig({ AUTH_METHOD: "basic" })).toThrow(
        /AUTH_USERNAME/,
      );
      expect(() =>
        loadConfig({ AUTH_METHOD: "basic", AUTH_USERNAME: "admin" }),
      ).toThrow(/AUTH_PASSWORD/);
    });

    it("collects the credentials", () => {
      const config = loadConfig({
        AUTH_METHOD: "basic",
        AUTH_USERNAME: "admin",
        AUTH_PASSWORD: "secret",
      });
      expect(config.authMethod).toBe("basic");
      expect(config.basicAuth).toEqual({
        username: "admin",
        password: "secret",
      });
    });
  });

  describe("AUTH_METHOD=keycloak", () => {
    it.each(["KEYCLOAK_URL", "KEYCLOAK_REALM", "KEYCLOAK_CLIENT_ID"])(
      "requires %s",
      (missing) => {
        const env: NodeJS.ProcessEnv = {
          AUTH_METHOD: "keycloak",
          KEYCLOAK_URL: "http://keycloak:8080",
          KEYCLOAK_REALM: "file-manager",
          KEYCLOAK_CLIENT_ID: "file-manager",
        };
        delete env[missing];
        expect(() => loadConfig(env)).toThrow(new RegExp(missing));
      },
    );

    it("collects the Keycloak settings", () => {
      const config = loadConfig({
        AUTH_METHOD: "keycloak",
        KEYCLOAK_URL: "http://keycloak:8080",
        KEYCLOAK_REALM: "file-manager",
        KEYCLOAK_CLIENT_ID: "file-manager",
      });
      expect(config.authMethod).toBe("keycloak");
      expect(config.keycloak).toEqual({
        url: "http://keycloak:8080",
        realm: "file-manager",
        clientId: "file-manager",
        internalUrl: "http://keycloak:8080",
      });
    });

    it("supports a separate internal URL for JWKS fetching", () => {
      const config = loadConfig({
        AUTH_METHOD: "keycloak",
        KEYCLOAK_URL: "http://localhost:8081",
        KEYCLOAK_INTERNAL_URL: "http://keycloak:8080",
        KEYCLOAK_REALM: "file-manager",
        KEYCLOAK_CLIENT_ID: "file-manager",
      });
      expect(config.keycloak?.url).toBe("http://localhost:8081");
      expect(config.keycloak?.internalUrl).toBe("http://keycloak:8080");
    });
  });
});
