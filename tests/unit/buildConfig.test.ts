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
    process.env["AUTH_SERVICE_JWKS_URI"] =
      "https://cdn.example.com/.well-known/jwks.json";

    const config = buildConfig();

    expect(config.jwksUri).toBe(
      "https://cdn.example.com/.well-known/jwks.json",
    );
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

  it("audience is undefined when AUTH_SERVICE_AUDIENCE is not set", () => {
    process.env["AUTH_SERVICE_URL"] = "https://auth.example.com";
    process.env["AUTH_SERVICE_APP_SLUG"] = "my-app";
    delete process.env["AUTH_SERVICE_AUDIENCE"];

    const config = buildConfig();

    expect(config.audience).toBeUndefined();
  });

  it("includes audience override when AUTH_SERVICE_AUDIENCE is set", () => {
    process.env["AUTH_SERVICE_URL"] = "https://auth.example.com";
    process.env["AUTH_SERVICE_APP_SLUG"] = "my-app";
    process.env["AUTH_SERVICE_AUDIENCE"] = "https://api.example.com";

    const config = buildConfig();

    expect(config.audience).toBe("https://api.example.com");
  });
});

describe("buildConfig() — provider and auth-service options", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it("defaults to the native auth-service provider", () => {
    process.env["AUTH_SERVICE_URL"] = "https://auth.example.com";
    process.env["AUTH_SERVICE_APP_SLUG"] = "my-app";

    const config = buildConfig();

    expect(config.provider).toBe("auth-service");
    expect(config.allowMachineTokens).toBe(false);
    expect(config.adminRoles).toEqual(["admin"]);
    expect(config.claims?.roles).toBe("roles");
  });

  it("reads the gateway URL and strips its trailing slash", () => {
    process.env["AUTH_SERVICE_URL"] = "https://auth.example.com";
    process.env["AUTH_SERVICE_APP_SLUG"] = "my-app";
    process.env["AUTH_SERVICE_GATEWAY_URL"] = "https://llm.example.com/";

    const config = buildConfig();

    expect(config.gatewayUrl).toBe("https://llm.example.com");
  });

  it("reads machine-token, admin-role and clock options", () => {
    process.env["AUTH_SERVICE_URL"] = "https://auth.example.com";
    process.env["AUTH_SERVICE_APP_SLUG"] = "my-app";
    process.env["AUTH_SERVICE_ALLOW_MACHINE_TOKENS"] = "true";
    process.env["AUTH_SERVICE_ADMIN_ROLES"] = "admin, owner";
    process.env["OIDC_CLOCK_TOLERANCE_SECONDS"] = "30";

    const config = buildConfig();

    expect(config.allowMachineTokens).toBe(true);
    expect(config.adminRoles).toEqual(["admin", "owner"]);
    expect(config.clockToleranceSeconds).toBe(30);
  });

  it("rejects an unsupported provider", () => {
    process.env["OIDC_PROVIDER"] = "saml";

    expect(() => buildConfig()).toThrow(/Unsupported OIDC_PROVIDER/);
  });

  it("rejects an invalid boolean", () => {
    process.env["AUTH_SERVICE_URL"] = "https://auth.example.com";
    process.env["AUTH_SERVICE_APP_SLUG"] = "my-app";
    process.env["AUTH_SERVICE_ALLOW_MACHINE_TOKENS"] = "maybe";

    expect(() => buildConfig()).toThrow(/Invalid boolean/);
  });

  it("rejects an invalid clock tolerance", () => {
    process.env["AUTH_SERVICE_URL"] = "https://auth.example.com";
    process.env["AUTH_SERVICE_APP_SLUG"] = "my-app";
    process.env["OIDC_CLOCK_TOLERANCE_SECONDS"] = "900";

    expect(() => buildConfig()).toThrow(/Invalid OIDC_CLOCK_TOLERANCE_SECONDS/);
  });

  it("builds a generic OIDC configuration", () => {
    process.env["OIDC_PROVIDER"] = "oidc";
    process.env["OIDC_ISSUER"] =
      "https://login.microsoftonline.com/tenant/v2.0/";
    process.env["OIDC_JWKS_URI"] =
      "https://login.microsoftonline.com/tenant/discovery/v2.0/keys";
    process.env["OIDC_AUDIENCE"] = "api://my-api";
    process.env["OIDC_CLIENT_ID"] = "client-123";
    process.env["OIDC_ALGORITHMS"] = "RS256,RS384";
    process.env["OIDC_ROLES_CLAIM"] = "roles";
    process.env["OIDC_PERMISSIONS_CLAIM"] = "scp";
    process.env["OIDC_AUTHORIZED_PARTY_CLAIMS"] = "azp,appid";

    const config = buildConfig();

    expect(config.provider).toBe("oidc");
    expect(config.authServiceUrl).toBe(
      "https://login.microsoftonline.com/tenant/v2.0",
    );
    expect(config.issuer).toBe("https://login.microsoftonline.com/tenant/v2.0");
    expect(config.appSlug).toBe("client-123");
    expect(config.audience).toBe("api://my-api");
    expect(config.algorithms).toEqual(["RS256", "RS384"]);
    expect(config.allowMachineTokens).toBe(true);
    expect(config.claims?.permissions).toBe("scp");
    expect(config.claims?.authorizedParty).toEqual(["azp", "appid"]);
  });

  it("requires the generic OIDC issuer, JWKS and audience", () => {
    process.env["OIDC_PROVIDER"] = "oidc";

    expect(() => buildConfig()).toThrow(/OIDC_ISSUER/);
    process.env["OIDC_ISSUER"] = "https://issuer.example.com";
    expect(() => buildConfig()).toThrow(/OIDC_JWKS_URI/);
    process.env["OIDC_JWKS_URI"] = "https://issuer.example.com/jwks";
    expect(() => buildConfig()).toThrow(/OIDC_AUDIENCE/);
  });
});

describe("buildConfig() — URL validation", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it("rejects a non-absolute native URL", () => {
    process.env["AUTH_SERVICE_URL"] = "auth.example.com";
    process.env["AUTH_SERVICE_APP_SLUG"] = "my-app";

    expect(() => buildConfig()).toThrow(/must be an absolute URL/);
  });

  it("rejects a non-http native URL", () => {
    process.env["AUTH_SERVICE_URL"] = "ftp://auth.example.com";
    process.env["AUTH_SERVICE_APP_SLUG"] = "my-app";

    expect(() => buildConfig()).toThrow(/must use http or https/);
  });

  it("rejects an invalid explicit JWKS URL", () => {
    process.env["AUTH_SERVICE_URL"] = "https://auth.example.com";
    process.env["AUTH_SERVICE_APP_SLUG"] = "my-app";
    process.env["AUTH_SERVICE_JWKS_URI"] = "not-a-url";

    expect(() => buildConfig()).toThrow(/AUTH_SERVICE_JWKS_URI/);
  });

  it("rejects an invalid generic issuer URL", () => {
    process.env["OIDC_PROVIDER"] = "oidc";
    process.env["OIDC_ISSUER"] = "issuer";
    process.env["OIDC_JWKS_URI"] = "https://issuer.example.com/jwks";
    process.env["OIDC_AUDIENCE"] = "api://my-api";

    expect(() => buildConfig()).toThrow(/OIDC_ISSUER/);
  });
});

describe("buildConfig() — algorithm allow-list", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it("rejects symmetric and unsecured algorithms", () => {
    process.env["OIDC_PROVIDER"] = "oidc";
    process.env["OIDC_ISSUER"] = "https://issuer.example.com";
    process.env["OIDC_JWKS_URI"] = "https://issuer.example.com/jwks";
    process.env["OIDC_AUDIENCE"] = "api://my-api";
    process.env["OIDC_ALGORITHMS"] = "RS256,HS256,none";

    expect(() => buildConfig()).toThrow(/only accepts asymmetric/);
  });
});
