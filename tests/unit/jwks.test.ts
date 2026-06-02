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

    await expect(verifyOidcToken("tok", baseConfig)).rejects.toThrow("JWTExpired");
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
