import { describe, it, expect } from "vitest";
import { applyAuthContext } from "../../src/context.js";
import type { OidcUserContext } from "../../src/types.js";

function makeCtx(overrides: Partial<OidcUserContext> = {}): OidcUserContext {
  return {
    userId: "sub-123",
    sub: "sub-123",
    email: "alice@example.com",
    name: "Alice",
    userRole: "user",
    roles: ["user"],
    permissions: ["reports"],
    features: { maxProjects: 3 },
    ...overrides,
  };
}

describe("applyAuthContext()", () => {
  it("copies the context, token and optional claims onto a target", () => {
    const target: Record<string, unknown> = {};
    applyAuthContext(
      target,
      makeCtx({
        plan: "pro",
        sid: "sid-1",
        clientId: "my-app",
        scopes: ["openid", "roles"],
        isMachine: false,
        emailVerified: true,
        org_id: "org-1",
        picture: "https://img.example.com/a.png",
        company: "CIRCLE",
      }),
      "raw-token",
      null,
    );

    expect(target["sub"]).toBe("sub-123");
    expect(target["userId"]).toBe("sub-123");
    expect(target["userRole"]).toBe("user");
    expect(target["roles"]).toEqual(["user"]);
    expect(target["permissions"]).toEqual(["reports"]);
    expect(target["features"]).toEqual({ maxProjects: 3 });
    expect(target["plan"]).toBe("pro");
    expect(target["sid"]).toBe("sid-1");
    expect(target["clientId"]).toBe("my-app");
    expect(target["scopes"]).toEqual(["openid", "roles"]);
    expect(target["isMachine"]).toBe(false);
    expect(target["authToken"]).toBe("raw-token");
    expect(target["auth"]).toBeInstanceOf(Object);
    expect((target["auth"] as OidcUserContext).userId).toBe("sub-123");
    expect(target["org_id"]).toBe("org-1");
  });

  it("prefers the local user id and role, and nulls absent optionals", () => {
    const target: Record<string, unknown> = {};
    applyAuthContext(target, makeCtx(), "raw-token", {
      id: "db-id",
      role: "admin",
      isDisabled: false,
    });

    expect(target["userId"]).toBe("db-id");
    expect(target["userRole"]).toBe("admin");
    expect((target["auth"] as OidcUserContext).userId).toBe("db-id");
    expect((target["auth"] as OidcUserContext).userRole).toBe("admin");
    expect(target["plan"]).toBeNull();
    expect(target["sid"]).toBeNull();
    expect(target["clientId"]).toBeNull();
    expect(target["scopes"]).toEqual([]);
    expect(target["isMachine"]).toBe(false);
    expect("org_id" in target).toBe(false);
  });
});
