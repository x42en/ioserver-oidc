import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildConfig } from "../../src/OidcConfigManager.js";

describe("buildConfig()", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it("throws when AUTH_SERVICE_URL is missing", () => {
    delete process.env["AUTH_SERVICE_URL"];
    process.env["AUTH_SERVICE_APP_SLUG"] = "my-app";

    expect(() => buildConfig()).toThrow(
      "[OidcConfigManager] AUTH_SERVICE_URL environment variable is required.",
    );
  });

  it("throws when AUTH_SERVICE_APP_SLUG is missing", () => {
    process.env["AUTH_SERVICE_URL"] = "https://auth.example.com";
    delete process.env["AUTH_SERVICE_APP_SLUG"];

    expect(() => buildConfig()).toThrow(
      "[OidcConfigManager] AUTH_SERVICE_APP_SLUG environment variable is required.",
    );
  });

  it("returns a valid config with minimal env vars", () => {
    process.env["AUTH_SERVICE_URL"] = "https://auth.example.com";
    process.env["AUTH_SERVICE_APP_SLUG"] = "my-app";

    const config = buildConfig();

    expect(config.authServiceUrl).toBe("https://auth.example.com");
    expect(config.appSlug).toBe("my-app");
    expect(config.jwksUri).toBeUndefined();
    expect(config.issuer).toBeUndefined();
  });

  it("strips trailing slash from authServiceUrl", () => {
    process.env["AUTH_SERVICE_URL"] = "https://auth.example.com/";
    process.env["AUTH_SERVICE_APP_SLUG"] = "my-app";

    const config = buildConfig();

    expect(config.authServiceUrl).toBe("https://auth.example.com");
  });

  it("includes jwksUri override when AUTH_SERVICE_JWKS_URI is set", () => {
    process.env["AUTH_SERVICE_URL"] = "https://auth.example.com";
    process.env["AUTH_SERVICE_APP_SLUG"] = "my-app";
    process.env["AUTH_SERVICE_JWKS_URI"] = "https://cdn.example.com/.well-known/jwks.json";

    const config = buildConfig();

    expect(config.jwksUri).toBe("https://cdn.example.com/.well-known/jwks.json");
  });

  it("includes issuer override when AUTH_SERVICE_ISSUER is set", () => {
    process.env["AUTH_SERVICE_URL"] = "https://auth.example.com";
    process.env["AUTH_SERVICE_APP_SLUG"] = "my-app";
    process.env["AUTH_SERVICE_ISSUER"] = "https://custom-issuer.example.com";

    const config = buildConfig();

    expect(config.issuer).toBe("https://custom-issuer.example.com");
  });

  it("includes both overrides when both env vars are set", () => {
    process.env["AUTH_SERVICE_URL"] = "https://auth.example.com";
    process.env["AUTH_SERVICE_APP_SLUG"] = "my-app";
    process.env["AUTH_SERVICE_JWKS_URI"] = "https://cdn.example.com/jwks";
    process.env["AUTH_SERVICE_ISSUER"] = "https://issuer.example.com";

    const config = buildConfig();

    expect(config.jwksUri).toBe("https://cdn.example.com/jwks");
    expect(config.issuer).toBe("https://issuer.example.com");
  });
});
