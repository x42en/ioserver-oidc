import { createHmac } from "node:crypto";
import Fastify from "fastify";
import { describe, it, expect, vi } from "vitest";
import { registerResourceWebhook } from "../../src/webhook.js";

const SECRET = "webhook-secret";

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "event-1",
    type: "resource.grant.created",
    occurredAt: new Date().toISOString(),
    application: { id: "app-1", slug: "my-app" },
    resource: {
      id: "11111111-1111-4111-8111-111111111111",
      uri: "gine://project-42",
      scheme: "gine",
      displayName: "Project 42",
      ownerType: "user",
      ownerId: "user-1",
      status: "validated",
    },
    grant: {
      id: "22222222-2222-4222-8222-222222222222",
      subjectType: "user",
      subjectId: "user-2",
      expiresAt: null,
    },
    recipients: { userIds: ["user-2"], allMembers: false },
    ...overrides,
  };
}

function signature(body: string, timestamp = Math.floor(Date.now() / 1000)) {
  const digest = createHmac("sha256", SECRET)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

async function makeApp(options: { onEvent?: any; onError?: any } = {}) {
  const app = Fastify();
  const onEvent = options.onEvent ?? vi.fn();
  const onError = options.onError ?? vi.fn();
  registerResourceWebhook(app, { secret: SECRET, onEvent, onError });
  app.post("/json", async (request) => request.body);
  await app.ready();
  return { app, onEvent, onError };
}

describe("registerResourceWebhook()", () => {
  it("verifies a signed event, calls onEvent and returns 204", async () => {
    const { app, onEvent } = await makeApp();
    const body = JSON.stringify(makeEvent());

    const response = await app.inject({
      method: "POST",
      url: "/auth/resource-webhook",
      headers: {
        "content-type": "application/json",
        "x-auth-service-signature": signature(body),
      },
      payload: body,
    });

    expect(response.statusCode).toBe(204);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "event-1" }),
    );
    await app.close();
  });

  it("deduplicates a replayed eventId", async () => {
    const { app, onEvent } = await makeApp();
    const body = JSON.stringify(makeEvent());
    const headers = {
      "content-type": "application/json",
      "x-auth-service-signature": signature(body),
    };

    expect(
      (
        await app.inject({
          method: "POST",
          url: "/auth/resource-webhook",
          headers,
          payload: body,
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/auth/resource-webhook",
          headers,
          payload: body,
        })
      ).statusCode,
    ).toBe(204);

    expect(onEvent).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("rejects a bad signature and a stale timestamp", async () => {
    const { app, onError } = await makeApp();
    const body = JSON.stringify(makeEvent());

    const bad = await app.inject({
      method: "POST",
      url: "/auth/resource-webhook",
      headers: {
        "content-type": "application/json",
        "x-auth-service-signature": "t=1,v1=deadbeef",
      },
      payload: body,
    });
    const stale = await app.inject({
      method: "POST",
      url: "/auth/resource-webhook",
      headers: {
        "content-type": "application/json",
        "x-auth-service-signature": signature(body, 1),
      },
      payload: body,
    });

    expect(bad.statusCode).toBe(400);
    expect(stale.statusCode).toBe(400);
    expect(onError).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it("does not change JSON parsing for other routes", async () => {
    const { app } = await makeApp();

    const response = await app.inject({
      method: "POST",
      url: "/json",
      payload: { hello: "world" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ hello: "world" });
    await app.close();
  });

  it("returns 500 when onEvent fails", async () => {
    const onEvent = vi.fn().mockRejectedValue(new Error("store down"));
    const { app, onError } = await makeApp({ onEvent });
    const body = JSON.stringify(makeEvent());

    const response = await app.inject({
      method: "POST",
      url: "/auth/resource-webhook",
      headers: {
        "content-type": "application/json",
        "x-auth-service-signature": signature(body),
      },
      payload: body,
    });

    expect(response.statusCode).toBe(500);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    await app.close();
  });

  it("fails fast on a missing secret or invalid limits", () => {
    const app = Fastify();

    expect(() =>
      registerResourceWebhook(app as any, { secret: "", onEvent: vi.fn() }),
    ).toThrow(/secret is required/);
    expect(() =>
      registerResourceWebhook(app as any, {
        secret: SECRET,
        toleranceSeconds: -1,
        onEvent: vi.fn(),
      }),
    ).toThrow(/toleranceSeconds/);
    expect(() =>
      registerResourceWebhook(app as any, {
        secret: SECRET,
        maxBodyBytes: 0,
        onEvent: vi.fn(),
      }),
    ).toThrow(/maxBodyBytes/);
  });
});
