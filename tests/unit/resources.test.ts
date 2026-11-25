import { describe, it, expect, vi } from "vitest";
import {
  invalidateResource,
  listAccessibleResources,
  recordResourceUsage,
  requireResourceAccess,
  validateResource,
} from "../../src/resources.js";
import { OidcResourceError } from "../../src/errors.js";

function makeResources() {
  return {
    authorize: vi.fn(),
    listAccessible: vi.fn(),
    validate: vi.fn(),
    invalidate: vi.fn(),
    recordUsage: vi.fn(),
  };
}

function makeAppHandle(resources = makeResources(), config?: unknown) {
  return {
    log: vi.fn(),
    oidcMachine: { resources },
    ...(config === undefined
      ? {}
      : { oidcConfig: { getConfig: () => config } }),
  };
}

function allowDecision() {
  return {
    decision: "allow" as const,
    decisionId: "decision-1",
    expiresAt: "2026-11-25T00:01:00.000Z",
    resourceId: "resource-1",
    resourceUri: "gine://project-42",
    applicationSlug: "my-app",
    ownerType: "user" as const,
    ownerId: "user-1",
    accessKind: "owner" as const,
    permission: "write" as const,
  };
}

describe("requireResourceAccess()", () => {
  it("sends the verified subject and audience, and the client only as actor", async () => {
    const resources = makeResources();
    resources.authorize.mockResolvedValue(allowDecision());
    const appHandle = makeAppHandle(resources, {
      audience: "https://api.example.com",
    });
    const request = {
      sub: "user-1",
      clientId: "my-app",
      audiences: ["https://api.example.com"],
    };

    const decision = await requireResourceAccess(
      appHandle as any,
      request,
      "gine://project-42",
      { requestId: "req-1", source: "api" },
    );

    expect(decision.decision).toBe("allow");
    expect((request as any).resourceAccess).toEqual(decision);
    expect(resources.authorize).toHaveBeenCalledWith({
      subjectId: "user-1",
      actorClientId: "my-app",
      resourceUri: "gine://project-42",
      audience: "https://api.example.com",
      requestId: "req-1",
      source: "api",
    });
    expect(resources.authorize.mock.calls[0]?.[0]).not.toHaveProperty(
      "clientId",
    );
  });

  it("asks for the requested level and omits it otherwise", async () => {
    const resources = makeResources();
    resources.authorize.mockResolvedValue(allowDecision());
    const appHandle = makeAppHandle(resources, {
      audience: "https://api.example.com",
    }) as any;

    await requireResourceAccess(appHandle, { sub: "u" }, "gine://r", {
      permission: "write",
    });
    await requireResourceAccess(appHandle, { sub: "u" }, "gine://r");

    expect(resources.authorize.mock.calls[0]?.[0]).toMatchObject({
      permission: "write",
    });
    expect(resources.authorize.mock.calls[1]?.[0]).not.toHaveProperty(
      "permission",
    );
    expect(resources.authorize.mock.calls[1]?.[0]).not.toHaveProperty(
      "actorClientId",
    );
  });

  it("falls back to the token audience and nested auth context", async () => {
    const resources = makeResources();
    resources.authorize.mockResolvedValue(allowDecision());
    const request = {
      auth: {
        sub: "user-1",
        clientId: "my-app",
        audiences: ["https://resource.example.com"],
      },
    };

    await requireResourceAccess(
      makeAppHandle(resources) as any,
      request,
      "gine://project-42",
    );

    expect(resources.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: "user-1",
        actorClientId: "my-app",
        audience: "https://resource.example.com",
      }),
    );
  });

  it("fails closed on a deny, an error, a machine token or missing context", async () => {
    const denied = makeResources();
    denied.authorize.mockResolvedValue({ decision: "deny" });

    await expect(
      requireResourceAccess(
        makeAppHandle(denied, { audience: "https://api.example.com" }) as any,
        { sub: "u", clientId: "c" },
        "gine://r",
      ),
    ).rejects.toMatchObject({ code: "ERR_RESOURCE_FORBIDDEN" });

    const failed = makeResources();
    failed.authorize.mockRejectedValue(new Error("timeout"));

    await expect(
      requireResourceAccess(
        makeAppHandle(failed, { audience: "https://api.example.com" }) as any,
        { sub: "u", clientId: "c" },
        "gine://r",
      ),
    ).rejects.toMatchObject({ code: "ERR_RESOURCE_FORBIDDEN" });

    await expect(
      requireResourceAccess(
        makeAppHandle(denied, { audience: "https://api.example.com" }) as any,
        { sub: "c", clientId: "c", isMachine: true },
        "gine://r",
      ),
    ).rejects.toMatchObject({ code: "ERR_RESOURCE_FORBIDDEN" });

    await expect(
      requireResourceAccess(
        makeAppHandle(denied) as any,
        { clientId: "c" },
        "gine://r",
      ),
    ).rejects.toMatchObject({ code: "ERR_RESOURCE_CONFIG" });
  });

  it("fails closed without an audience or a machine manager", async () => {
    const resources = makeResources();
    resources.authorize.mockResolvedValue(allowDecision());

    await expect(
      requireResourceAccess(
        makeAppHandle(resources) as any,
        { sub: "u", clientId: "c" },
        "gine://r",
      ),
    ).rejects.toMatchObject({ code: "ERR_RESOURCE_CONFIG" });

    await expect(
      requireResourceAccess(
        { log: vi.fn() } as any,
        { sub: "u", clientId: "c" },
        "gine://r",
      ),
    ).rejects.toMatchObject({ code: "ERR_RESOURCE_CONFIG" });
  });

  it("wraps unexpected SDK errors", async () => {
    const resources = makeResources();
    resources.authorize.mockRejectedValue(new Error("boom"));

    await expect(
      requireResourceAccess(
        makeAppHandle(resources, {
          audience: "https://api.example.com",
        }) as any,
        { sub: "u", clientId: "c" },
        "gine://r",
      ),
    ).rejects.toMatchObject({
      code: "ERR_RESOURCE_FORBIDDEN",
      statusCode: 403,
      status: 403,
    });
    await expect(
      requireResourceAccess(
        makeAppHandle(makeResources()) as any,
        { sub: "u", clientId: "c" },
        "gine://r",
      ),
    ).rejects.toMatchObject({ statusCode: 500 });
    expect(
      new OidcResourceError("ERR_RESOURCE_FORBIDDEN", "denied"),
    ).toBeInstanceOf(Error);
  });
});

describe("resource wrappers", () => {
  it("delegates list, validate, invalidate and usage calls", async () => {
    const resources = makeResources();
    resources.listAccessible.mockResolvedValue([]);
    resources.validate.mockResolvedValue({ id: "r" });
    resources.invalidate.mockResolvedValue({ id: "r" });
    resources.recordUsage.mockResolvedValue({ replayed: false });
    const appHandle = makeAppHandle(resources) as any;

    await expect(
      listAccessibleResources(appHandle, "u", { scheme: "llm" }),
    ).resolves.toEqual([]);
    await expect(
      validateResource(appHandle, "r", { result: "validated" }),
    ).resolves.toEqual({ id: "r" });
    await expect(
      invalidateResource(appHandle, "r", "deleted"),
    ).resolves.toEqual({ id: "r" });
    await expect(
      recordResourceUsage(appHandle, {
        decisionId: "decision-1",
        startedAt: new Date(),
        resourceId: "r",
        resourceUri: "gine://r",
        requestId: "a".repeat(64),
        occurredAt: new Date(),
        usageSource: "unsupported",
      } as any),
    ).resolves.toEqual({ replayed: false });

    expect(resources.listAccessible).toHaveBeenCalledWith("u", {
      scheme: "llm",
    });
    expect(resources.validate).toHaveBeenCalledWith("r", {
      result: "validated",
    });
    expect(resources.invalidate).toHaveBeenCalledWith("r", "deleted");
    expect(resources.recordUsage).toHaveBeenCalled();
  });
});
