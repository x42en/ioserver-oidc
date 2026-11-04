import { describe, it, expect, vi } from "vitest";
import type { AuthClient } from "@circle-rd/auth-ai";
import { registerBackchannelLogout } from "../../src/backchannel.js";

interface RegisteredRoute {
  path: string;
  options: { bodyLimit: number };
  handler: (request: unknown, reply: unknown) => Promise<void>;
}

function makeApp(hasFormParser = false) {
  let route: RegisteredRoute | undefined;
  let parserAdded = false;
  let hasParser = hasFormParser;
  let parser: ((request: unknown, body: string, done: unknown) => void) | null =
    null;
  const app = {
    post(
      path: string,
      options: { bodyLimit: number },
      handler: RegisteredRoute["handler"],
    ) {
      route = { path, options, handler };
      return app;
    },
    hasContentTypeParser(contentType: string) {
      expect(contentType).toBe("application/x-www-form-urlencoded");
      return hasParser;
    },
    addContentTypeParser(
      contentType: string,
      _options: { parseAs: "string" },
      registered: (request: unknown, body: string, done: unknown) => void,
    ) {
      expect(contentType).toBe("application/x-www-form-urlencoded");
      parserAdded = true;
      hasParser = true;
      parser = registered;
      return app;
    },
  };
  return {
    app,
    route: () => route,
    parserAdded: () => parserAdded,
    parser: () => parser,
  };
}

function makeReply() {
  const reply = {
    status: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    code(status: number) {
      this.status = status;
      return this;
    },
    header(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    send(body?: unknown) {
      this.body = body;
    },
  };
  return reply;
}

function makeAuth(
  verifyJwt: (
    token: string,
    options: unknown,
  ) => Promise<Record<string, unknown>>,
) {
  return {
    config: { clientId: "my-app", clockToleranceSeconds: 5 },
    verifyJwt,
  } as unknown as AuthClient;
}

function logoutPayload(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: "user-1",
    sid: "sid-1",
    jti: "jti-1",
    iat: now,
    exp: now + 120,
    events: { "http://schemas.openid.net/event/backchannel-logout": {} },
    ...overrides,
  };
}

function request(
  body: unknown,
  contentType = "application/x-www-form-urlencoded",
) {
  return {
    url: "/auth/backchannel-logout",
    method: "POST",
    headers: { host: "app.example.com", "content-type": contentType },
    body,
  };
}

describe("registerBackchannelLogout()", () => {
  it("registers the default route and accepts a valid logout token", async () => {
    const { app, route, parserAdded } = makeApp();
    const onLogout = vi.fn();
    registerBackchannelLogout(app, {
      auth: makeAuth(async () => logoutPayload()),
      onLogout,
    });

    const registered = route();
    expect(registered?.path).toBe("/auth/backchannel-logout");
    expect(parserAdded()).toBe(true);
    expect(registered?.options.bodyLimit).toBe(16_384);

    const reply = makeReply();
    await registered?.handler(request({ logout_token: "token" }), reply);

    expect(reply.status).toBe(204);
    expect(reply.headers["cache-control"]).toBe("no-store");
    expect(onLogout).toHaveBeenCalledWith({ sid: "sid-1", sub: "user-1" });
  });

  it("registers a parser that forwards the raw form body", () => {
    const { app, parser } = makeApp();
    registerBackchannelLogout(app, {
      auth: makeAuth(async () => logoutPayload()),
      onLogout: vi.fn(),
    });

    const done = vi.fn();
    parser()?.({}, "logout_token=token", done);

    expect(done).toHaveBeenCalledWith(null, "logout_token=token");
  });

  it("accepts a raw string body", async () => {
    const { app, route } = makeApp();
    const onLogout = vi.fn();
    registerBackchannelLogout(app, {
      auth: makeAuth(async () => logoutPayload()),
      onLogout,
    });

    const reply = makeReply();
    await route()?.handler(request("logout_token=token"), reply);

    expect(reply.status).toBe(204);
    expect(onLogout).toHaveBeenCalled();
  });

  it("does not replace an existing form parser", () => {
    const { app, parserAdded } = makeApp(true);
    registerBackchannelLogout(app, {
      auth: makeAuth(async () => logoutPayload()),
      onLogout: vi.fn(),
    });

    expect(parserAdded()).toBe(false);
  });

  it("supports a custom path and rejects a wrong content type", async () => {
    const { app, route } = makeApp();
    registerBackchannelLogout(app, {
      auth: makeAuth(async () => logoutPayload()),
      path: "/custom/logout",
      onLogout: vi.fn(),
    });

    const reply = makeReply();
    await route()?.handler(request({}, "application/json"), reply);

    expect(route()?.path).toBe("/custom/logout");
    expect(reply.status).toBe(400);
    expect(reply.body).toEqual({ error: "invalid_request" });
  });

  it("rejects a malformed request authority", async () => {
    const { app, route } = makeApp();
    registerBackchannelLogout(app, {
      auth: makeAuth(async () => logoutPayload()),
      onLogout: vi.fn(),
    });

    const reply = makeReply();
    await route()?.handler(
      {
        ...request({ logout_token: "token" }),
        headers: {
          host: "[",
          "content-type": "application/x-www-form-urlencoded",
        },
      },
      reply,
    );

    expect(reply.status).toBe(400);
  });

  it("accepts a Buffer body", async () => {
    const { app, route } = makeApp();
    const onLogout = vi.fn();
    registerBackchannelLogout(app, {
      auth: makeAuth(async () => logoutPayload()),
      onLogout,
    });

    const reply = makeReply();
    await route()?.handler(
      request(Buffer.from("logout_token=token", "utf8")),
      reply,
    );

    expect(reply.status).toBe(204);
    expect(onLogout).toHaveBeenCalled();
  });

  it("rejects a missing logout_token", async () => {
    const { app, route } = makeApp();
    registerBackchannelLogout(app, {
      auth: makeAuth(async () => logoutPayload()),
      onLogout: vi.fn(),
    });

    const reply = makeReply();
    await route()?.handler(request({}), reply);

    expect(reply.status).toBe(400);
  });

  it("rejects a replayed logout token", async () => {
    const { app, route } = makeApp();
    registerBackchannelLogout(app, {
      auth: makeAuth(async () => logoutPayload()),
      onLogout: vi.fn(),
    });
    const handler = route()?.handler;

    const first = makeReply();
    await handler?.(request({ logout_token: "token" }), first);
    const replay = makeReply();
    await handler?.(request({ logout_token: "token" }), replay);

    expect(first.status).toBe(204);
    expect(replay.status).toBe(400);
  });

  it("reports rejected tokens without leaking detail", async () => {
    const { app, route } = makeApp();
    const onError = vi.fn();
    registerBackchannelLogout(app, {
      auth: makeAuth(async () => {
        throw new Error("bad signature");
      }),
      onLogout: vi.fn(),
      onError,
    });

    const reply = makeReply();
    await route()?.handler(request({ logout_token: "token" }), reply);

    expect(reply.status).toBe(400);
    expect(JSON.parse(String(reply.body))).toEqual({
      error: "invalid_request",
    });
    expect(onError).toHaveBeenCalled();
  });

  it("returns 500 when onLogout throws", async () => {
    const { app, route } = makeApp();
    registerBackchannelLogout(app, {
      auth: makeAuth(async () => logoutPayload()),
      onLogout: () => {
        throw new Error("store down");
      },
    });

    const reply = makeReply();
    await route()?.handler(request({ logout_token: "token" }), reply);

    expect(reply.status).toBe(500);
  });

  it("requires a config or an auth client", () => {
    const { app } = makeApp();
    expect(() => registerBackchannelLogout(app, { onLogout: vi.fn() })).toThrow(
      /requires a config or an auth client/,
    );
  });

  it("builds a verifier from a valid config", () => {
    const { app } = makeApp();
    expect(() =>
      registerBackchannelLogout(app, {
        config: {
          authServiceUrl: "https://auth.example.com",
          appSlug: "my-app",
        },
        onLogout: vi.fn(),
      }),
    ).not.toThrow();
  });

  it("builds a client from a config, requiring a client id", () => {
    const { app } = makeApp();
    expect(() =>
      registerBackchannelLogout(app, {
        config: { authServiceUrl: "https://auth.example.com", appSlug: "" },
        onLogout: vi.fn(),
      }),
    ).toThrow(/appSlug/);
  });
});
