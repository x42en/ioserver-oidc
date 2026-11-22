import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock jose before importing module under test ─────────────────────────────
const mockJwtVerify = vi.fn();
const mockCreateRemoteJWKSet = vi.fn();

class JWTClaimValidationFailed extends Error {
  claim?: string;
  reason?: string;
  constructor(
    message: string,
    _payload: unknown,
    claim?: string,
    reason?: string,
  ) {
    super(message);
    this.name = "JWTClaimValidationFailed";
    this.claim = claim;
    this.reason = reason;
  }
}

vi.mock("jose", () => ({
  jwtVerify: mockJwtVerify,
  createRemoteJWKSet: mockCreateRemoteJWKSet,
  errors: { JWTClaimValidationFailed },
}));

// Import AFTER mock is registered
const { verifyOidcToken } = await import("../../src/jwks.js");

describe("jwks — verifyOidcToken()", () => {
  const baseConfig = {
    authServiceUrl: "https://auth.example.com",
    appSlug: "my-app",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateRemoteJWKSet.mockReturnValue({ _keyset: true });
  });

  it("builds default JWKS URI from authServiceUrl", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "user-1", roles: [], permissions: [], features: {} },
    });

    await verifyOidcToken("tok", baseConfig);

    expect(mockCreateRemoteJWKSet).toHaveBeenCalledWith(
      new URL("https://auth.example.com/api/auth/jwks"),
    );
  });

  it("uses explicit jwksUri override", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "user-1", roles: [], permissions: [], features: {} },
    });

    await verifyOidcToken("tok", {
      ...baseConfig,
      jwksUri: "https://cdn.example.com/my-jwks",
    });

    expect(mockCreateRemoteJWKSet).toHaveBeenCalledWith(
      new URL("https://cdn.example.com/my-jwks"),
    );
  });

  it("uses default issuer (authServiceUrl without trailing slash)", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "user-1", roles: [], permissions: [], features: {} },
    });

    await verifyOidcToken("tok", {
      authServiceUrl: "https://auth.example.com/",
      appSlug: "my-app",
    });

    expect(mockJwtVerify).toHaveBeenCalledWith(
      "tok",
      expect.anything(),
      expect.objectContaining({ issuer: "https://auth.example.com" }),
    );
  });

  it("uses explicit issuer override", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "user-1", roles: [], permissions: [], features: {} },
    });

    await verifyOidcToken("tok", {
      ...baseConfig,
      issuer: "https://custom-issuer.example.com",
    });

    expect(mockJwtVerify).toHaveBeenCalledWith(
      "tok",
      expect.anything(),
      expect.objectContaining({ issuer: "https://custom-issuer.example.com" }),
    );
  });

  it("reuses cached keyset for the same JWKS URI", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "user-1", roles: [], permissions: [], features: {} },
    });

    // Use a unique URI to isolate cache for this test
    const uniqueConfig = {
      authServiceUrl: "https://unique-cache-test.example.com",
      appSlug: "my-app",
    };

    await verifyOidcToken("tok", uniqueConfig);
    await verifyOidcToken("tok", uniqueConfig);

    // createRemoteJWKSet must be called only once across two calls
    expect(mockCreateRemoteJWKSet).toHaveBeenCalledTimes(1);
  });

  it("maps full claim set to OidcUserContext", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        sub: "user-abc",
        email: "alice@example.com",
        name: "Alice",
        roles: ["admin", "user"],
        permissions: ["read", "write"],
        features: { maxProjects: 10 },
      },
    });

    const ctx = await verifyOidcToken("tok", baseConfig);

    expect(ctx).toEqual({
      userId: "user-abc",
      sub: "user-abc",
      email: "alice@example.com",
      name: "Alice",
      userRole: "admin",
      roles: ["admin", "user"],
      permissions: ["read", "write"],
      features: { maxProjects: 10 },
    });
  });

  it("falls back to userRole='user' when roles array is empty", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "user-1", roles: [], permissions: [], features: {} },
    });

    const ctx = await verifyOidcToken("tok", baseConfig);

    expect(ctx.userRole).toBe("user");
    expect(ctx.roles).toEqual([]);
  });

  it("falls back to empty arrays and objects for missing claims", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "user-1" },
    });

    const ctx = await verifyOidcToken("tok", baseConfig);

    expect(ctx.email).toBeNull();
    expect(ctx.name).toBeNull();
    expect(ctx.roles).toEqual([]);
    expect(ctx.permissions).toEqual([]);
    expect(ctx.features).toEqual({});
  });

  it("re-throws when jose.jwtVerify throws", async () => {
    mockJwtVerify.mockRejectedValue(new Error("JWTExpired"));

    await expect(verifyOidcToken("tok", baseConfig)).rejects.toThrow(
      "JWTExpired",
    );
  });

  it("uses config.audience when set (RFC 8707 resource URL)", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        sub: "user-1",
        azp: "my-app",
        roles: [],
        permissions: [],
        features: {},
      },
    });

    await verifyOidcToken("tok", {
      ...baseConfig,
      audience: "https://api.example.com",
    });

    expect(mockJwtVerify).toHaveBeenCalledWith(
      "tok",
      expect.anything(),
      expect.objectContaining({ audience: "https://api.example.com" }),
    );
  });

  it("falls back to appSlug as audience when config.audience is not set", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "user-1", roles: [], permissions: [], features: {} },
    });

    await verifyOidcToken("tok", baseConfig);

    expect(mockJwtVerify).toHaveBeenCalledWith(
      "tok",
      expect.anything(),
      expect.objectContaining({ audience: "my-app" }),
    );
  });

  // ── Algorithm allow-list (FINDING-4) ──────────────────────────────────────

  it("pins an asymmetric algorithm allow-list by default (excludes HS*/none)", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "user-1", roles: [], permissions: [], features: {} },
    });

    await verifyOidcToken("tok", baseConfig);

    const opts = mockJwtVerify.mock.calls[0]?.[2] as { algorithms: string[] };
    expect(opts.algorithms).toEqual(
      expect.arrayContaining(["RS256", "ES256", "EdDSA"]),
    );
    expect(opts.algorithms).not.toContain("HS256");
    expect(opts.algorithms).not.toContain("none");
  });

  it("uses config.algorithms override when provided", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "user-1", roles: [], permissions: [], features: {} },
    });

    await verifyOidcToken("tok", { ...baseConfig, algorithms: ["ES256"] });

    expect(mockJwtVerify).toHaveBeenCalledWith(
      "tok",
      expect.anything(),
      expect.objectContaining({ algorithms: ["ES256"] }),
    );
  });

  // ── Authorized-party binding (FINDING-1) ──────────────────────────────────

  it("accepts a token whose azp matches appSlug", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "user-1", azp: "my-app", roles: [], permissions: [] },
    });

    const ctx = await verifyOidcToken("tok", baseConfig);
    expect(ctx.sub).toBe("user-1");
  });

  it("rejects a token whose azp does not match appSlug (cross-app token)", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "user-1", azp: "other-app", roles: ["admin"] },
    });

    await expect(verifyOidcToken("tok", baseConfig)).rejects.toThrow(
      /authorized party/i,
    );
  });

  it("accepts client_id as authorized party fallback when azp is absent", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "user-1", client_id: "my-app", roles: [] },
    });

    const ctx = await verifyOidcToken("tok", baseConfig);
    expect(ctx.sub).toBe("user-1");
  });

  it("rejects a non-matching client_id when azp is absent", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "user-1", client_id: "other-app", roles: ["admin"] },
    });

    await expect(verifyOidcToken("tok", baseConfig)).rejects.toThrow(
      /authorized party/i,
    );
  });

  it("allows a missing party claim in legacy audience mode (aud = appSlug)", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "user-1", roles: [], permissions: [] },
    });

    const ctx = await verifyOidcToken("tok", baseConfig);
    expect(ctx.sub).toBe("user-1");
  });

  it("requires a party claim in resource-audience mode (RFC 8707)", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "user-1", roles: ["admin"] },
    });

    await expect(
      verifyOidcToken("tok", {
        ...baseConfig,
        audience: "https://api.example.com",
      }),
    ).rejects.toThrow(/authorized party/i);
  });

  it("accepts matching azp in resource-audience mode", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "user-1", azp: "my-app", roles: [] },
    });

    const ctx = await verifyOidcToken("tok", {
      ...baseConfig,
      audience: "https://api.example.com",
    });
    expect(ctx.sub).toBe("user-1");
  });

  // ── Strict claim element validation (FINDING-6) ───────────────────────────

  it("filters out non-string elements from roles and permissions", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        sub: "user-1",
        roles: ["admin", 123, null, { x: 1 }, "user"],
        permissions: ["read", 42, "write", false],
      },
    });

    const ctx = await verifyOidcToken("tok", baseConfig);

    expect(ctx.roles).toEqual(["admin", "user"]);
    expect(ctx.permissions).toEqual(["read", "write"]);
    expect(ctx.userRole).toBe("admin");
  });
});

describe("jwks — provider features", () => {
  const baseConfig = {
    authServiceUrl: "https://auth.example.com",
    appSlug: "my-app",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateRemoteJWKSet.mockReturnValue({ _keyset: true });
  });

  it("maps plan, session, scopes and client id", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        sub: "user-1",
        azp: "my-app",
        scope: "openid roles wallet:self:read",
        plan: "pro",
        sid: "sid-1",
        email_verified: true,
        picture: "https://img.example.com/a.png",
        company: "CIRCLE",
        roles: ["editor"],
      },
    });

    const ctx = await verifyOidcToken("tok", baseConfig);

    expect(ctx.plan).toBe("pro");
    expect(ctx.sid).toBe("sid-1");
    expect(ctx.clientId).toBe("my-app");
    expect(ctx.scopes).toEqual(["openid", "roles", "wallet:self:read"]);
    expect(ctx.emailVerified).toBe(true);
    expect(ctx.picture).toBe("https://img.example.com/a.png");
    expect(ctx.company).toBe("CIRCLE");
  });

  it("rejects client_credentials tokens by default in native mode", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "my-app", azp: "my-app", roles: [] },
    });

    await expect(verifyOidcToken("tok", baseConfig)).rejects.toMatchObject({
      code: "ERR_MACHINE_TOKEN_FORBIDDEN",
    });
  });

  it("accepts client_credentials tokens when explicitly allowed", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "my-app", azp: "my-app", roles: [] },
    });

    const ctx = await verifyOidcToken("tok", {
      ...baseConfig,
      allowMachineTokens: true,
    });

    expect(ctx.isMachine).toBe(true);
  });

  it("uses custom claim names for a generic provider", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        sub: "user-1",
        appid: "client-123",
        groups: ["editor"],
        scp: ["read", "write"],
        entitlements: { beta: true },
        tenant: "org-1",
        mail: "bob@example.com",
        displayName: "Bob",
      },
    });

    const ctx = await verifyOidcToken("tok", {
      provider: "oidc",
      authServiceUrl: "https://issuer.example.com",
      appSlug: "client-123",
      audience: "api://my-api",
      issuer: "https://issuer.example.com",
      jwksUri: "https://issuer.example.com/jwks",
      claims: {
        roles: "groups",
        permissions: "scp",
        features: "entitlements",
        plan: "plan",
        orgId: "tenant",
        email: "mail",
        name: "displayName",
        picture: "picture",
        company: "company",
        authorizedParty: ["appid", "azp"],
      },
    });

    expect(ctx.roles).toEqual(["editor"]);
    expect(ctx.permissions).toEqual(["read", "write"]);
    expect(ctx.features).toEqual({ beta: true });
    expect(ctx.email).toBe("bob@example.com");
    expect(ctx.name).toBe("Bob");
    expect(ctx.org_id).toBe("org-1");
    expect(ctx.clientId).toBe("client-123");
  });

  it("derives the generic JWKS default from the issuer", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "user-1", azp: "client-123", aud: "api://my-api" },
    });

    await verifyOidcToken("tok", {
      provider: "oidc",
      authServiceUrl: "https://issuer.example.com",
      appSlug: "client-123",
      audience: "api://my-api",
      issuer: "https://issuer.example.com",
    });

    expect(mockCreateRemoteJWKSet).toHaveBeenCalledWith(
      new URL("https://issuer.example.com/.well-known/jwks.json"),
    );
  });
});

describe("jwks — token size", () => {
  it("rejects an empty token", async () => {
    await expect(
      verifyOidcToken("", {
        authServiceUrl: "https://auth.example.com",
        appSlug: "my-app",
      }),
    ).rejects.toMatchObject({ code: "ERR_AUTH_TOKEN_INVALID" });
  });

  it("rejects an oversized token before parsing", async () => {
    await expect(
      verifyOidcToken("x".repeat(16_385), {
        authServiceUrl: "https://auth.example.com",
        appSlug: "my-app",
      }),
    ).rejects.toMatchObject({ code: "ERR_AUTH_TOKEN_INVALID" });
    expect(mockJwtVerify).not.toHaveBeenCalled();
  });
});

describe("jwks — subject validation", () => {
  it("rejects a token without a string subject", async () => {
    mockCreateRemoteJWKSet.mockReturnValue({ _keyset: true });
    mockJwtVerify.mockResolvedValue({ payload: { azp: "my-app" } });

    await expect(
      verifyOidcToken("tok", {
        authServiceUrl: "https://auth.example.com",
        appSlug: "my-app",
      }),
    ).rejects.toThrow(/invalid "sub" claim/);
  });
});

describe("jwks — algorithm allow-list", () => {
  it("drops symmetric algorithms from a manual configuration", async () => {
    mockCreateRemoteJWKSet.mockReturnValue({ _keyset: true });
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "user-1", azp: "my-app" },
    });

    await verifyOidcToken("tok", {
      authServiceUrl: "https://auth.example.com",
      appSlug: "my-app",
      algorithms: ["HS256", "RS256"],
    });

    const opts = mockJwtVerify.mock.calls[0]?.[2] as { algorithms: string[] };
    expect(opts.algorithms).toEqual(["RS256"]);
  });

  it("refuses a configuration with no asymmetric algorithm", async () => {
    mockCreateRemoteJWKSet.mockReturnValue({ _keyset: true });

    await expect(
      verifyOidcToken("tok", {
        authServiceUrl: "https://auth.example.com",
        appSlug: "my-app",
        algorithms: ["HS256", "none"],
      }),
    ).rejects.toThrow(/No asymmetric JWS algorithm/);
  });
});

describe("jwks — token type hardening", () => {
  const baseConfig = {
    authServiceUrl: "https://auth.example.com",
    appSlug: "my-app",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateRemoteJWKSet.mockReturnValue({ _keyset: true });
  });

  it("rejects an ID token marker such as nonce", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "user-1", azp: "my-app", nonce: "n-1" },
    });

    await expect(verifyOidcToken("tok", baseConfig)).rejects.toThrow(/nonce/);
  });

  it("rejects a token whose token_use is not access", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "user-1", azp: "my-app", token_use: "id" },
    });

    await expect(verifyOidcToken("tok", baseConfig)).rejects.toThrow(
      /token_use/,
    );
  });

  it("rejects an id+jwt protected header", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "user-1", azp: "my-app" },
      protectedHeader: { typ: "id+jwt" },
    });

    await expect(verifyOidcToken("tok", baseConfig)).rejects.toThrow(/typ/);
  });

  it("passes the configured typ and requires standard claims", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "user-1", azp: "my-app" },
      protectedHeader: { typ: "at+jwt" },
    });

    await verifyOidcToken("tok", { ...baseConfig, tokenType: "at+jwt" });

    expect(mockJwtVerify).toHaveBeenCalledWith(
      "tok",
      expect.anything(),
      expect.objectContaining({
        typ: "at+jwt",
        requiredClaims: ["exp", "iss", "aud", "sub"],
      }),
    );
  });
});

describe("jwks — generic machine tokens", () => {
  const genericConfig = {
    provider: "oidc" as const,
    authServiceUrl: "https://issuer.example.com",
    appSlug: "client-123",
    audience: "https://api.example.com",
    issuer: "https://issuer.example.com",
    jwksUri: "https://issuer.example.com/jwks",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateRemoteJWKSet.mockReturnValue({ _keyset: true });
  });

  it("refuses a generic client_credentials token by default", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        sub: "client-123",
        azp: "client-123",
        roles: ["admin"],
      },
    });

    await expect(verifyOidcToken("tok", genericConfig)).rejects.toMatchObject({
      code: "ERR_MACHINE_TOKEN_FORBIDDEN",
    });
  });

  it("marks and accepts a generic machine token only when opted in", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: "client-123", azp: "client-123" },
    });

    const ctx = await verifyOidcToken("tok", {
      ...genericConfig,
      allowMachineTokens: true,
    });

    expect(ctx.isMachine).toBe(true);
  });
});
