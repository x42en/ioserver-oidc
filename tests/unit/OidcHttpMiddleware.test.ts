import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OidcUserContext } from "../../src/types.js";

// ── Mock verifyOidcToken ──────────────────────────────────────────────────────
const mockVerifyOidcToken = vi.fn<() => Promise<OidcUserContext>>();

vi.mock("../../src/jwks.js", () => ({
  verifyOidcToken: mockVerifyOidcToken,
}));

const { OidcHttpMiddleware } = await import("../../src/OidcHttpMiddleware.js");

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeOidcCtx(overrides: Partial<OidcUserContext> = {}): OidcUserContext {
  return {
    userId: "ctx-user",
    sub: "sub-123",
    email: "alice@example.com",
    name: "Alice",
    userRole: "user",
    roles: ["user"],
    permissions: [],
    features: {},
    ...overrides,
  };
}

function makeRequest(authHeader?: string) {
  return { headers: { authorization: authHeader } } as any;
}

function makeReply() {
  const reply = {
    _code: 0,
    _body: null as any,
    code(n: number) {
      this._code = n;
      return this;
    },
    send(body: any) {
      this._body = body;
    },
  };
  return reply;
}

function makeAppHandle(overrides: Record<string, unknown> = {}) {
  return {
    log: vi.fn(),
    ...overrides,
  };
}

describe("OidcHttpMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["AUTH_SERVICE_URL"] = "https://auth.example.com";
    process.env["AUTH_SERVICE_APP_SLUG"] = "my-app";
  });

  function getInstance(appHandleOverrides: Record<string, unknown> = {}) {
    const appHandle = makeAppHandle(appHandleOverrides);
    const middleware = new OidcHttpMiddleware(appHandle as any);
    const handler = middleware.handle(appHandle as any);
    return { handler, appHandle };
  }

  it("replies 401 when Authorization header is absent", async () => {
    const { handler } = getInstance();
    const req = makeRequest(undefined);
    const reply = makeReply();

    await handler(req, reply);

    expect(reply._code).toBe(401);
    expect(reply._body.code).toBe("ERR_AUTH_TOKEN_REQUIRED");
  });

  it("replies 401 when Authorization header is not Bearer", async () => {
    const { handler } = getInstance();
    const req = makeRequest("Basic dXNlcjpwYXNz");
    const reply = makeReply();

    await handler(req, reply);

    expect(reply._code).toBe(401);
    expect(reply._body.code).toBe("ERR_AUTH_TOKEN_REQUIRED");
  });

  it("replies 401 when JWT verification fails", async () => {
    mockVerifyOidcToken.mockRejectedValue(new Error("JWTExpired"));

    const { handler } = getInstance();
    const req = makeRequest("Bearer bad-token");
    const reply = makeReply();

    await handler(req, reply);

    expect(reply._code).toBe(401);
    expect(reply._body.code).toBe("ERR_AUTH_TOKEN_INVALID");
  });

  it("injects auth context on valid token with no users manager", async () => {
    mockVerifyOidcToken.mockResolvedValue(makeOidcCtx());

    const { handler } = getInstance();
    const req = makeRequest("Bearer valid-token");
    const reply = makeReply();

    await handler(req, reply);

    expect(reply._code).toBe(0); // no error response
    expect((req as any).sub).toBe("sub-123");
    expect((req as any).userId).toBe("sub-123"); // falls back to sub
    expect((req as any).userRole).toBe("user");
    expect((req as any).roles).toEqual(["user"]);
    expect((req as any).permissions).toEqual([]);
    expect((req as any).features).toEqual({});
  });

  it("uses user.id and user.role from findOrCreate when available", async () => {
    mockVerifyOidcToken.mockResolvedValue(makeOidcCtx({ sub: "sub-123", userRole: "user" }));

    const mockUser = { id: "db-user-id", role: "admin", isDisabled: false };
    const appHandle = makeAppHandle({
      users: { findOrCreate: vi.fn().mockResolvedValue(mockUser) },
    });
    const middleware = new OidcHttpMiddleware(appHandle as any);
    const handler = middleware.handle(appHandle as any);

    const req = makeRequest("Bearer valid-token");
    const reply = makeReply();

    await handler(req, reply);

    expect((req as any).userId).toBe("db-user-id");
    expect((req as any).userRole).toBe("admin");
  });

  it("replies 500 when findOrCreate throws", async () => {
    mockVerifyOidcToken.mockResolvedValue(makeOidcCtx());

    const appHandle = makeAppHandle({
      users: { findOrCreate: vi.fn().mockRejectedValue(new Error("DB error")) },
    });
    const middleware = new OidcHttpMiddleware(appHandle as any);
    const handler = middleware.handle(appHandle as any);

    const req = makeRequest("Bearer valid-token");
    const reply = makeReply();

    await handler(req, reply);

    expect(reply._code).toBe(500);
    expect(reply._body.code).toBe("ERR_USER_PROVISION_FAILED");
  });

  it("replies 403 when user.isDisabled is true", async () => {
    mockVerifyOidcToken.mockResolvedValue(makeOidcCtx());

    const appHandle = makeAppHandle({
      users: {
        findOrCreate: vi.fn().mockResolvedValue({
          id: "db-id",
          role: "user",
          isDisabled: true,
        }),
      },
    });
    const middleware = new OidcHttpMiddleware(appHandle as any);
    const handler = middleware.handle(appHandle as any);

    const req = makeRequest("Bearer valid-token");
    const reply = makeReply();

    await handler(req, reply);

    expect(reply._code).toBe(403);
    expect(reply._body.code).toBe("ERR_ACCOUNT_DISABLED");
  });

  it("uses config from appHandle.oidcConfig when available", async () => {
    mockVerifyOidcToken.mockResolvedValue(makeOidcCtx());

    const oidcConfig = {
      authServiceUrl: "https://other-auth.example.com",
      appSlug: "other-app",
    };
    const appHandle = makeAppHandle({
      oidcConfig: { getConfig: vi.fn().mockReturnValue(oidcConfig) },
    });
    const middleware = new OidcHttpMiddleware(appHandle as any);
    const handler = middleware.handle(appHandle as any);

    await handler(makeRequest("Bearer tok"), makeReply());

    expect(mockVerifyOidcToken).toHaveBeenCalledWith("tok", oidcConfig);
  });

  it("falls back to env-based config when no oidcConfig manager", async () => {
    mockVerifyOidcToken.mockResolvedValue(makeOidcCtx());

    const { handler } = getInstance();

    await handler(makeRequest("Bearer tok"), makeReply());

    expect(mockVerifyOidcToken).toHaveBeenCalledWith(
      "tok",
      expect.objectContaining({ authServiceUrl: "https://auth.example.com" }),
    );
  });

  it("caches resolved config after first request", async () => {
    mockVerifyOidcToken.mockResolvedValue(makeOidcCtx());

    const getConfig = vi.fn().mockReturnValue({
      authServiceUrl: "https://auth.example.com",
      appSlug: "my-app",
    });
    const appHandle = makeAppHandle({ oidcConfig: { getConfig } });
    const middleware = new OidcHttpMiddleware(appHandle as any);
    const handler = middleware.handle(appHandle as any);

    await handler(makeRequest("Bearer tok"), makeReply());
    await handler(makeRequest("Bearer tok"), makeReply());

    expect(getConfig).toHaveBeenCalledTimes(1);
  });
});
