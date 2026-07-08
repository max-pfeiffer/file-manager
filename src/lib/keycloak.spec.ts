import { beforeEach, describe, expect, it, vi } from "vitest";

import { initKeycloak } from "./keycloak";

const { keycloakMock, instance } = vi.hoisted(() => {
  const instance = {
    token: "initial-token",
    init: vi.fn().mockResolvedValue(true),
    updateToken: vi.fn().mockResolvedValue(true),
    login: vi.fn(),
    onTokenExpired: undefined as (() => void) | undefined,
    onAuthRefreshSuccess: undefined as (() => void) | undefined,
  };
  return { instance, keycloakMock: vi.fn(() => instance) };
});

vi.mock("keycloak-js", () => ({ default: keycloakMock }));

const settings = {
  url: "http://keycloak:8080",
  realm: "file-manager",
  clientId: "file-manager",
};

describe("initKeycloak", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    instance.token = "initial-token";
  });

  it("initializes with login-required and PKCE", async () => {
    await initKeycloak(settings, { onToken: vi.fn() });
    expect(keycloakMock).toHaveBeenCalledWith({
      url: settings.url,
      realm: settings.realm,
      clientId: settings.clientId,
    });
    expect(instance.init).toHaveBeenCalledWith({
      onLoad: "login-required",
      pkceMethod: "S256",
      checkLoginIframe: false,
    });
  });

  it("reports the initial token", async () => {
    const onToken = vi.fn();
    await initKeycloak(settings, { onToken });
    expect(onToken).toHaveBeenCalledWith("initial-token");
  });

  it("reports refreshed tokens", async () => {
    const onToken = vi.fn();
    await initKeycloak(settings, { onToken });
    instance.token = "refreshed-token";
    instance.onAuthRefreshSuccess?.();
    expect(onToken).toHaveBeenLastCalledWith("refreshed-token");
  });

  it("refreshes the token when it expires", async () => {
    await initKeycloak(settings, { onToken: vi.fn() });
    instance.onTokenExpired?.();
    expect(instance.updateToken).toHaveBeenCalledWith(30);
  });

  it("falls back to a full login when refresh fails", async () => {
    await initKeycloak(settings, { onToken: vi.fn() });
    instance.updateToken.mockRejectedValueOnce(new Error("refresh failed"));
    instance.onTokenExpired?.();
    await vi.waitFor(() => expect(instance.login).toHaveBeenCalled());
  });
});
