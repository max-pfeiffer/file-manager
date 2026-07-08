import { computed, ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import type Keycloak from "keycloak-js";

import type { AuthMethod } from "./config";

/**
 * Authentication state. Credentials live in memory only — never in
 * localStorage — so a reload requires logging in again.
 */
export const useAuthStore = defineStore("auth", () => {
  const method = ref<AuthMethod>("none");
  const basicCredentials = ref<string | null>(null);
  const keycloak = shallowRef<Keycloak | null>(null);
  const keycloakToken = ref<string | null>(null);

  const isAuthenticated = computed(() => {
    if (method.value === "basic") return basicCredentials.value !== null;
    if (method.value === "keycloak") return keycloakToken.value !== null;
    return true;
  });

  /** True when the basic-auth login form must be shown. */
  const requiresLogin = computed(
    () => method.value === "basic" && basicCredentials.value === null,
  );

  function setMethod(value: AuthMethod): void {
    method.value = value;
  }

  function loginBasic(username: string, password: string): void {
    basicCredentials.value = btoa(`${username}:${password}`);
  }

  function logoutBasic(): void {
    basicCredentials.value = null;
  }

  function setKeycloak(instance: Keycloak): void {
    keycloak.value = instance;
    keycloakToken.value = instance.token ?? null;
  }

  function updateKeycloakToken(token: string | null): void {
    keycloakToken.value = token;
  }

  /** Authorization header for the active method, if authenticated. */
  function authHeader(): Record<string, string> {
    if (method.value === "basic" && basicCredentials.value) {
      return { Authorization: `Basic ${basicCredentials.value}` };
    }
    if (method.value === "keycloak" && keycloakToken.value) {
      return { Authorization: `Bearer ${keycloakToken.value}` };
    }
    return {};
  }

  return {
    method,
    basicCredentials,
    keycloak,
    keycloakToken,
    isAuthenticated,
    requiresLogin,
    setMethod,
    loginBasic,
    logoutBasic,
    setKeycloak,
    updateKeycloakToken,
    authHeader,
  };
});
