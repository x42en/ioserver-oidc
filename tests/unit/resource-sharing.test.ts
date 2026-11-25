import { describe, it, expect, vi, beforeEach } from "vitest";
import { createResourceSharingClient } from "../../src/resource-sharing.js";

const TOKEN = "user-token";
const CONFIG = {
  authServiceUrl: "https://auth.example.com",
  issuer: "https://auth.example.com",
  appSlug: "my-app",
};
const RESOURCE_ID = "11111111-1111-4111-8111-111111111111";

function grant(permission: "read" | "write") {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    resourceId: RESOURCE_ID,
    subjectType: "user",
    subjectId: "user-2",
    permission,
    expiresAt: null,
    revokedAt: null,
    createdBy: "user-1",
    createdAt: "2026-11-25T00:00:00.000Z",
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createResourceSharingClient()", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  function client() {
    return createResourceSharingClient({
      config: CONFIG,
      token: TOKEN,
      fetch: fetchMock as unknown as typeof fetch,
    });
  }

  it("creates a write grant and changes its level with the user bearer token", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ grant: grant("write") }, 201))
      .mockResolvedValueOnce(json({ grant: grant("read") }));

    const created = await client().createGrant(RESOURCE_ID, {
      subjectType: "user",
      subjectId: "user-2",
      permission: "write",
    });
    const updated = await client().updateGrant(RESOURCE_ID, created.id, {
      permission: "read",
    });

    expect(created.permission).toBe("write");
    expect(updated.permission).toBe("read");
    const [createUrl, createInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(createUrl)).toBe(
      `https://auth.example.com/api/user/resources/${RESOURCE_ID}/grants`,
    );
    expect(JSON.parse(String(createInit?.body))).toMatchObject({
      permission: "write",
    });
    expect(new Headers(createInit?.headers).get("authorization")).toBe(
      `Bearer ${TOKEN}`,
    );
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("PATCH");
  });

  it("refuses a level outside the closed set before any request", async () => {
    await expect(
      client().createGrant(RESOURCE_ID, {
        subjectType: "user",
        subjectId: "user-2",
        permission: "admin" as never,
      }),
    ).rejects.toMatchObject({ code: "CFG_001" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects missing tokens, a missing client id and the generic OIDC provider", () => {
    expect(() =>
      createResourceSharingClient({ config: CONFIG, token: "" }),
    ).toThrow(/access token/);
    expect(() =>
      createResourceSharingClient({
        config: { ...CONFIG, appSlug: "" },
        token: TOKEN,
      }),
    ).toThrow(/appSlug/);
    expect(() =>
      createResourceSharingClient({
        config: { ...CONFIG, provider: "oidc" },
        token: TOKEN,
      }),
    ).toThrow(/only available for auth-service/);
  });
});
