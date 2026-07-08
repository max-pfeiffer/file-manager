import Keycloak from "keycloak-js";

import type { KeycloakSettings } from "@/stores/config";

export interface KeycloakCallbacks {
  /** Invoked with the current access token after init and every refresh. */
  onToken: (token: string | null) => void;
}

/**
 * Initializes Keycloak with the Authorization Code flow + PKCE and waits
 * for authentication (login-required) — the app only mounts afterwards.
 * Token refresh happens silently via onTokenExpired.
 */
export async function initKeycloak(
  settings: KeycloakSettings,
  callbacks: KeycloakCallbacks,
): Promise<Keycloak> {
  const keycloak = new Keycloak({
    url: settings.url,
    realm: settings.realm,
    clientId: settings.clientId,
  });

  keycloak.onTokenExpired = () => {
    keycloak.updateToken(30).catch(() => keycloak.login());
  };
  keycloak.onAuthRefreshSuccess = () => {
    callbacks.onToken(keycloak.token ?? null);
  };

  await keycloak.init({
    onLoad: "login-required",
    pkceMethod: "S256",
    checkLoginIframe: false,
  });

  callbacks.onToken(keycloak.token ?? null);
  return keycloak;
}
