import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useConfigStore } from "./config";

const { httpMock } = vi.hoisted(() => ({ httpMock: vi.fn() }));

vi.mock("@/lib/http", () => ({ http: httpMock }));

describe("config store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    httpMock.mockReset();
  });

  it("starts without configuration", () => {
    const store = useConfigStore();
    expect(store.config).toBeNull();
  });

  it("loads the runtime config from /api/config", async () => {
    httpMock.mockResolvedValue({ authMethod: "none" });
    const store = useConfigStore();
    const config = await store.load();
    expect(httpMock).toHaveBeenCalledWith("/api/config");
    expect(config).toEqual({ authMethod: "none" });
    expect(store.config).toEqual({ authMethod: "none" });
  });

  it("exposes Keycloak settings when present", async () => {
    const keycloak = {
      url: "http://keycloak:8080",
      realm: "file-manager",
      clientId: "file-manager",
    };
    httpMock.mockResolvedValue({ authMethod: "keycloak", keycloak });
    const store = useConfigStore();
    await store.load();
    expect(store.config?.keycloak).toEqual(keycloak);
  });

  it("propagates load failures", async () => {
    httpMock.mockRejectedValue(new Error("boom"));
    const store = useConfigStore();
    await expect(store.load()).rejects.toThrow("boom");
    expect(store.config).toBeNull();
  });
});
