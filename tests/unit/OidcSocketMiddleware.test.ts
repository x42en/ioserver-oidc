import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OidcUserContext } from "../../src/types.js";

// ── Mock verifyOidcToken ──────────────────────────────────────────────────────
const mockVerifyOidcToken = vi.fn<() => Promise<OidcUserContext>>();

vi.mock("../../src/jwks.js", () => ({
  verifyOidcToken: mockVerifyOidcToken,
}));

const { OidcSocketMiddleware } = await import("../../src/OidcSocketMiddleware.js");

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

function makeSocket(token?: string, headerToken?: string) {
  const listeners: Record<string, (() => void)[]> = {};
  return {
    handshake: {
      auth: token !== undefined ? { token } : {},
      headers: headerToken ? { authorization: `Bearer ${headerToken}` } : {},
    },
    nsp: { name: "/tenants" },
    id: "socket-id-1",
    on(event: string, cb: () => void) {
      listeners[event] = [...(listeners[event] ?? []), cb];
    },
    _emit(event: string) {
      listeners[event]?.forEach((cb) => cb());
    },
    _listeners: listeners,
  } as any;
}

function makeAppHandle(overrides: Record<string, unknown> = {}) {
  return { log: vi.fn(), ...overrides };
}

describe("OidcSocketMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["AUTH_SERVICE_URL"] = "https://auth.example.com";
    process.env["AUTH_SERVICE_APP_SLUG"] = "my-app";
  });

  function getInstance(appHandleOverrides: Record<string, unknown> = {}) {
    const appHandle = makeAppHandle(appHandleOverrides);
    const middleware = new OidcSocketMiddleware(appHandle as any);
    const handler = middleware.handle(appHandle as any);
    return { handler, appHandle };
  }

  it("calls next(ERR_AUTH_TOKEN_REQUIRED) when no token is present", async () => {
    const { handler } = getInstance();
    const socket = makeSocket(undefined);
    const next = vi.fn();

    await handler(socket, next);

    expect(next).toHaveBeenCalledWith(new Error("ERR_AUTH_TOKEN_REQUIRED"));
  });

  it("accepts token from socket.handshake.auth.token", async () => {
    mockVerifyOidcToken.mockResolvedValue(makeOidcCtx());

    const { handler } = getInstance();
    const socket = makeSocket("my-token");
    const next = vi.fn();

    await handler(socket, next);

    expect(mockVerifyOidcToken).toHaveBeenCalledWith(
      "my-token",
      expect.anything(),
    );
    expect(next).toHaveBeenCalledWith();
  });

  it("accepts token from Authorization Bearer header", async () => {
    mockVerifyOidcToken.mockResolvedValue(makeOidcCtx());

    const { handler } = getInstance();
    const socket = makeSocket(undefined, "header-token");
    const next = vi.fn();

    await handler(socket, next);

    expect(mockVerifyOidcToken).toHaveBeenCalledWith(
      "header-token",
      expect.anything(),
    );
    expect(next).toHaveBeenCalledWith();
  });

  it("calls next(ERR_AUTH_TOKEN_INVALID) when JWT verification fails", async () => {
    mockVerifyOidcToken.mockRejectedValue(new Error("JWTExpired"));

    const { handler } = getInstance();
    const socket = makeSocket("bad-token");
    const next = vi.fn();

    await handler(socket, next);

    expect(next).toHaveBeenCalledWith(new Error("ERR_AUTH_TOKEN_INVALID"));
  });

  it("injects auth context when no users manager is present", async () => {
    mockVerifyOidcToken.mockResolvedValue(makeOidcCtx());

    const { handler } = getInstance();
    const socket = makeSocket("valid-token");
    const next = vi.fn();

    await handler(socket, next);

    expect(socket.sub).toBe("sub-123");
    expect(socket.userId).toBe("sub-123"); // falls back to sub
    expect(socket.userRole).toBe("user");
    expect(socket.roles).toEqual(["user"]);
    expect(socket.permissions).toEqual([]);
    expect(socket.features).toEqual({});
    expect(next).toHaveBeenCalledWith();
  });

  it("uses user.id and user.role from findOrCreate", async () => {
    mockVerifyOidcToken.mockResolvedValue(makeOidcCtx());

    const mockUser = { id: "db-id", role: "admin", isDisabled: false };
    const { handler } = getInstance({
      users: { findOrCreate: vi.fn().mockResolvedValue(mockUser) },
    });
    const socket = makeSocket("valid-token");
    const next = vi.fn();

    await handler(socket, next);

    expect(socket.userId).toBe("db-id");
    expect(socket.userRole).toBe("admin");
  });

  it("calls next(ERR_USER_PROVISION_FAILED) when findOrCreate throws", async () => {
    mockVerifyOidcToken.mockResolvedValue(makeOidcCtx());

    const { handler } = getInstance({
      users: { findOrCreate: vi.fn().mockRejectedValue(new Error("DB error")) },
    });
    const socket = makeSocket("valid-token");
    const next = vi.fn();

    await handler(socket, next);

    expect(next).toHaveBeenCalledWith(new Error("ERR_USER_PROVISION_FAILED"));
  });

  it("calls next(ERR_ACCOUNT_DISABLED) when user.isDisabled is true", async () => {
    mockVerifyOidcToken.mockResolvedValue(makeOidcCtx());

    const { handler } = getInstance({
      users: {
        findOrCreate: vi.fn().mockResolvedValue({
          id: "db-id",
          role: "user",
          isDisabled: true,
        }),
      },
    });
    const socket = makeSocket("valid-token");
    const next = vi.fn();

    await handler(socket, next);

    expect(next).toHaveBeenCalledWith(new Error("ERR_ACCOUNT_DISABLED"));
  });

  it("calls session.registerSocket when session manager is present", async () => {
    mockVerifyOidcToken.mockResolvedValue(makeOidcCtx());

    const registerSocket = vi.fn();
    const { handler } = getInstance({
      session: { registerSocket },
    });
    const socket = makeSocket("valid-token");
    const next = vi.fn();

    await handler(socket, next);

    expect(registerSocket).toHaveBeenCalledWith(
      socket,
      "tenants",
      "alice@example.com",
      "Alice",
    );
  });

  it("calls session.unregisterSocket on disconnect", async () => {
    mockVerifyOidcToken.mockResolvedValue(makeOidcCtx());

    const unregisterSocket = vi.fn();
    const { handler } = getInstance({
      session: { registerSocket: vi.fn(), unregisterSocket },
    });
    const socket = makeSocket("valid-token");
    const next = vi.fn();

    await handler(socket, next);
    socket._emit("disconnect");

    expect(unregisterSocket).toHaveBeenCalledWith("socket-id-1");
  });

  it("caches resolved config after first call", async () => {
    mockVerifyOidcToken.mockResolvedValue(makeOidcCtx());

    const getConfig = vi.fn().mockReturnValue({
      authServiceUrl: "https://auth.example.com",
      appSlug: "my-app",
    });
    const appHandle = makeAppHandle({ oidcConfig: { getConfig } });
    const middleware = new OidcSocketMiddleware(appHandle as any);
    const handler = middleware.handle(appHandle as any);

    await handler(makeSocket("tok"), vi.fn());
    await handler(makeSocket("tok"), vi.fn());

    expect(getConfig).toHaveBeenCalledTimes(1);
  });
});
