import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { OidcConfigManager } from "../../src/OidcConfigManager.js";

describe("OidcConfigManager", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = {
      ...OLD_ENV,
      AUTH_SERVICE_URL: "https://auth.example.com",
      AUTH_SERVICE_APP_SLUG: "my-app",
    };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  function makeAppHandle() {
    const logs: Array<[number, string]> = [];
    return {
      log: (level: number, msg: string) => logs.push([level, msg]),
      logs,
    };
  }

  it("throws when getConfig() is called before start()", () => {
    const appHandle = makeAppHandle();
    const manager = new OidcConfigManager(appHandle as any);

    expect(() => manager.getConfig()).toThrow(
      "[OidcConfigManager] getConfig() called before start()",
    );
  });

  it("start() initializes config and logs", async () => {
    const appHandle = makeAppHandle();
    const manager = new OidcConfigManager(appHandle as any);

    await manager.start();

    expect(appHandle.logs.length).toBe(1);
    expect(appHandle.logs[0]?.[0]).toBe(6);
    expect(appHandle.logs[0]?.[1]).toContain("OidcConfigManager");
  });

  it("getConfig() returns config after start()", async () => {
    const appHandle = makeAppHandle();
    const manager = new OidcConfigManager(appHandle as any);

    await manager.start();
    const config = manager.getConfig();

    expect(config.authServiceUrl).toBe("https://auth.example.com");
    expect(config.appSlug).toBe("my-app");
  });

  it("getConfig() returns the same reference on repeated calls", async () => {
    const appHandle = makeAppHandle();
    const manager = new OidcConfigManager(appHandle as any);

    await manager.start();
    const config1 = manager.getConfig();
    const config2 = manager.getConfig();

    expect(config1).toBe(config2);
  });
});
