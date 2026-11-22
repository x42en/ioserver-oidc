import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OidcMachineManager } from "../../src/OidcMachineManager.js";
import type { OidcConfig } from "../../src/types.js";

function config(overrides: Partial<OidcConfig> = {}): OidcConfig {
  return {
    provider: "auth-service",
    authServiceUrl: "https://auth.example.com",
    appSlug: "my-app",
    ...overrides,
  };
}

function appHandle(cfg: OidcConfig | Error) {
  return {
    log: vi.fn(),
    oidcConfig: {
      getConfig: () => {
        if (cfg instanceof Error) throw cfg;
        return cfg;
      },
    },
  };
}

describe("OidcMachineManager", () => {
  beforeEach(() => {
    delete process.env["OIDC_CLIENT_SECRET"];
    delete process.env["AUTH_SERVICE_MACHINE_REDIRECT_URI"];
    delete process.env["AUTH_SERVICE_TOKEN_ENDPOINT_AUTH_METHOD"];
    process.env["AUTH_SERVICE_CLIENT_SECRET"] = "machine-secret";
  });

  afterEach(() => {
    delete process.env["AUTH_SERVICE_CLIENT_SECRET"];
  });

  it("builds the machine API from the OIDC config", () => {
    const handle = appHandle(config());
    const manager = new OidcMachineManager(handle as any);

    expect(manager.api).toBeDefined();
    expect(manager.resources).toBe(manager.api.resources);
    expect(manager.resources.authorize).toBeTypeOf("function");
    expect(handle.log).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("machine-secret"),
    );
  });

  it("requires OidcConfigManager and appSlug", () => {
    expect(() => new OidcMachineManager({ log: vi.fn() } as any)).toThrow(
      /OidcConfigManager/,
    );

    expect(
      () => new OidcMachineManager(appHandle(config({ appSlug: "" })) as any),
    ).toThrow(/appSlug/);
  });

  it("refuses the generic OIDC provider", () => {
    expect(
      () =>
        new OidcMachineManager(appHandle(config({ provider: "oidc" })) as any),
    ).toThrow(/only available for auth-service/);
  });

  it("requires a client secret", () => {
    delete process.env["AUTH_SERVICE_CLIENT_SECRET"];

    expect(() => new OidcMachineManager(appHandle(config()) as any)).toThrow(
      /AUTH_SERVICE_CLIENT_SECRET/,
    );
  });

  it("rejects an unsupported token endpoint auth method", () => {
    process.env["AUTH_SERVICE_TOKEN_ENDPOINT_AUTH_METHOD"] = "private_key_jwt";
    try {
      expect(() => new OidcMachineManager(appHandle(config()) as any)).toThrow(
        /TOKEN_ENDPOINT_AUTH_METHOD/,
      );
    } finally {
      delete process.env["AUTH_SERVICE_TOKEN_ENDPOINT_AUTH_METHOD"];
    }
  });

  it("logs startup without exposing the secret", async () => {
    const handle = appHandle(config());
    const manager = new OidcMachineManager(handle as any);

    await manager.start();

    expect(handle.log).toHaveBeenCalledTimes(1);
    expect(String(handle.log.mock.calls[0]?.[1])).not.toContain(
      "machine-secret",
    );
  });

  it("fails when the config manager is not ready", () => {
    expect(
      () => new OidcMachineManager(appHandle(new Error("not ready")) as any),
    ).toThrow(/not ready/);
  });
});
