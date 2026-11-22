import { describe, it, expect, vi } from "vitest";
import { IOServer } from "ioserver";
import type { AuthClient } from "@circle-rd/auth-ai";
import { registerBackchannelLogout } from "../../src/backchannel.js";

function makeAuth(): AuthClient {
  const now = Math.floor(Date.now() / 1000);
  return {
    config: { clientId: "my-app", clockToleranceSeconds: 5 },
    verifyJwt: async () => ({
      sub: "user-1",
      sid: "sid-1",
      jti: "jti-integration",
      iat: now,
      exp: now + 120,
      events: { "http://schemas.openid.net/event/backchannel-logout": {} },
    }),
  } as unknown as AuthClient;
}

describe("back-channel logout on a real Fastify instance", () => {
  it("accepts a form-encoded logout token and returns 200", async () => {
    const server = new IOServer({ host: "127.0.0.1", port: 0 });
    const app = server.getApp();
    const onLogout = vi.fn();

    registerBackchannelLogout(app, {
      auth: makeAuth(),
      onLogout,
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/auth/backchannel-logout",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "logout_token=token",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(onLogout).toHaveBeenCalledWith({ sid: "sid-1", sub: "user-1" });
  });

  it("rejects a JSON body before token verification", async () => {
    const server = new IOServer({ host: "127.0.0.1", port: 0 });
    const app = server.getApp();
    const onLogout = vi.fn();

    registerBackchannelLogout(app, {
      auth: makeAuth(),
      onLogout,
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/auth/backchannel-logout",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ logout_token: "token" }),
    });

    expect(response.statusCode).toBe(400);
    expect(onLogout).not.toHaveBeenCalled();
  });
});
