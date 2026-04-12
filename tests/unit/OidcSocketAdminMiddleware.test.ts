import { describe, it, expect, vi } from "vitest";
import { OidcSocketAdminMiddleware } from "../../src/OidcSocketAdminMiddleware.js";

describe("OidcSocketAdminMiddleware", () => {
  function makeAppHandle() {
    return { log: vi.fn() };
  }

  function getInstance() {
    const appHandle = makeAppHandle();
    const middleware = new OidcSocketAdminMiddleware(appHandle as any);
    const handler = middleware.handle(appHandle as any);
    return handler;
  }

  it("calls next() without error when socket.roles includes 'admin'", () => {
    const handler = getInstance();
    const socket = { roles: ["user", "admin"], userRole: "admin" } as any;
    const next = vi.fn();

    handler(socket, next);

    expect(next).toHaveBeenCalledWith();
  });

  it("calls next(ERR_FORBIDDEN) when socket.roles lacks 'admin'", () => {
    const handler = getInstance();
    const socket = { roles: ["user"], userRole: "user" } as any;
    const next = vi.fn();

    handler(socket, next);

    expect(next).toHaveBeenCalledWith(new Error("ERR_FORBIDDEN"));
  });

  it("falls back to socket.userRole string when socket.roles is not an array", () => {
    const handler = getInstance();
    const socketAdmin = { userRole: "admin" } as any;
    const nextAdmin = vi.fn();

    handler(socketAdmin, nextAdmin);
    expect(nextAdmin).toHaveBeenCalledWith();

    const socketUser = { userRole: "user" } as any;
    const nextUser = vi.fn();

    handler(socketUser, nextUser);
    expect(nextUser).toHaveBeenCalledWith(new Error("ERR_FORBIDDEN"));
  });

  it("calls next(ERR_FORBIDDEN) when socket has no role information", () => {
    const handler = getInstance();
    const socket = {} as any;
    const next = vi.fn();

    handler(socket, next);

    expect(next).toHaveBeenCalledWith(new Error("ERR_FORBIDDEN"));
  });

  it("calls next(ERR_FORBIDDEN) when socket.roles is an empty array", () => {
    const handler = getInstance();
    const socket = { roles: [] } as any;
    const next = vi.fn();

    handler(socket, next);

    expect(next).toHaveBeenCalledWith(new Error("ERR_FORBIDDEN"));
  });
});
