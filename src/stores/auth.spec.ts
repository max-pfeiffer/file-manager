import type Keycloak from "keycloak-js";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { useAuthStore } from "./auth";

describe("auth store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe("method: none", () => {
    it("is always authenticated and sends no header", () => {
      const auth = useAuthStore();
      expect(auth.isAuthenticated).toBe(true);
      expect(auth.requiresLogin).toBe(false);
      expect(auth.authHeader()).toEqual({});
    });
  });

  describe("method: basic", () => {
    it("requires login until credentials are set", () => {
      const auth = useAuthStore();
      auth.setMethod("basic");
      expect(auth.isAuthenticated).toBe(false);
      expect(auth.requiresLogin).toBe(true);
    });

    it("builds a Basic authorization header after login", () => {
      const auth = useAuthStore();
      auth.setMethod("basic");
      auth.loginBasic("admin", "secret");
      expect(auth.isAuthenticated).toBe(true);
      expect(auth.requiresLogin).toBe(false);
      expect(auth.authHeader()).toEqual({
        Authorization: `Basic ${btoa("admin:secret")}`,
      });
    });

    it("clears credentials on logout", () => {
      const auth = useAuthStore();
      auth.setMethod("basic");
      auth.loginBasic("admin", "secret");
      auth.logoutBasic();
      expect(auth.requiresLogin).toBe(true);
      expect(auth.authHeader()).toEqual({});
    });
  });

  describe("method: keycloak", () => {
    it("is unauthenticated without a token", () => {
      const auth = useAuthStore();
      auth.setMethod("keycloak");
      expect(auth.isAuthenticated).toBe(false);
      expect(auth.authHeader()).toEqual({});
    });

    it("uses the token from the Keycloak instance", () => {
      const auth = useAuthStore();
      auth.setMethod("keycloak");
      auth.setKeycloak({ token: "jwt-token" } as Keycloak);
      expect(auth.isAuthenticated).toBe(true);
      expect(auth.authHeader()).toEqual({
        Authorization: "Bearer jwt-token",
      });
    });

    it("reflects token refreshes", () => {
      const auth = useAuthStore();
      auth.setMethod("keycloak");
      auth.setKeycloak({ token: "old" } as Keycloak);
      auth.updateKeycloakToken("new");
      expect(auth.authHeader()).toEqual({ Authorization: "Bearer new" });
    });

    it("never requires the basic login form", () => {
      const auth = useAuthStore();
      auth.setMethod("keycloak");
      expect(auth.requiresLogin).toBe(false);
    });
  });
});
