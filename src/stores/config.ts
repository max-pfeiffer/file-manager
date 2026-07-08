import { ref } from "vue";
import { defineStore } from "pinia";

import { http } from "@/lib/http";

export type AuthMethod = "basic" | "keycloak" | "none";

export interface KeycloakSettings {
  url: string;
  realm: string;
  clientId: string;
}

export interface RuntimeConfig {
  authMethod: AuthMethod;
  keycloak?: KeycloakSettings;
}

/**
 * Runtime configuration fetched from the backend before the app decides
 * how (and whether) to authenticate.
 */
export const useConfigStore = defineStore("config", () => {
  const config = ref<RuntimeConfig | null>(null);

  async function load(): Promise<RuntimeConfig> {
    config.value = await http<RuntimeConfig>("/api/config");
    return config.value;
  }

  return { config, load };
});
