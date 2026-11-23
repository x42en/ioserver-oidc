import { describe, it, expect, vi, beforeEach } from "vitest";
import { createOrganizationsClient } from "../../src/organizations.js";

const TOKEN = "user-token";
const CONFIG = {
  authServiceUrl: "https://auth.example.com",
  issuer: "https://auth.example.com",
  appSlug: "my-app",
};

const ORGANIZATION = {
  id: "org_1a2b-3c4d",
  name: "Acme Team",
  slug: "acme-team",
  logo: null,
  role: "owner",
  team: true,
  createdAt: "2026-11-23T00:00:00.000Z",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function noContent() {
  return new Response(null, { status: 204 });
}

describe("createOrganizationsClient()", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  function client() {
    return createOrganizationsClient({
      config: CONFIG,
      token: TOKEN,
      fetch: fetchMock as unknown as typeof fetch,
    });
  }

  it("lists organizations with the user bearer token", async () => {
    fetchMock.mockResolvedValue(json({ organizations: [ORGANIZATION] }));

    const organizations = await client().listOrganizations({ team: true });

    expect(organizations).toEqual([ORGANIZATION]);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://auth.example.com/api/user/organizations?team=true",
    );
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  it("creates a team without a slug", async () => {
    fetchMock.mockResolvedValue(json({ organization: ORGANIZATION }, 201));

    const organization = await client().create({
      name: "Acme Team",
      logo: "https://cdn.example.com/logo.png",
    });

    expect(organization.id).toBe(ORGANIZATION.id);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "Acme Team",
      logo: "https://cdn.example.com/logo.png",
    });
  });

  it("joins and leaves a team", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ organization: ORGANIZATION }, 201))
      .mockResolvedValueOnce(noContent());

    const org = await client().join("  invite-token  ");
    await client().leave("org_1a2b-3c4d");

    expect(org.id).toBe(ORGANIZATION.id);
    const [joinUrl, joinInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(joinUrl)).toBe(
      "https://auth.example.com/api/user/organizations/join",
    );
    expect(JSON.parse(String(joinInit?.body))).toEqual({
      token: "invite-token",
    });
    const [leaveUrl, leaveInit] = fetchMock.mock.calls[1] ?? [];
    expect(String(leaveUrl)).toBe(
      "https://auth.example.com/api/user/organizations/org_1a2b-3c4d/leave",
    );
    expect(leaveInit?.method).toBe("POST");
  });

  it("creates and revokes an invitation token", async () => {
    const invitation = {
      token: "invite-token",
      expiresAt: "2026-11-30T00:00:00.000Z",
    };
    fetchMock
      .mockResolvedValueOnce(json(invitation, 201))
      .mockResolvedValueOnce(noContent());

    const issued = await client().createInvitationToken("org_1");
    await client().revokeInvitationToken("org_1");

    expect(issued).toEqual(invitation);
    const [createUrl, createInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(createUrl)).toBe(
      "https://auth.example.com/api/user/organizations/org_1/invitation-token",
    );
    expect(createInit?.method).toBe("POST");
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("DELETE");
  });

  it("rejects missing or oversized tokens and a missing client id", () => {
    expect(() =>
      createOrganizationsClient({
        config: CONFIG,
        token: "",
      }),
    ).toThrow(/access token/);
    expect(() =>
      createOrganizationsClient({
        config: CONFIG,
        token: "x".repeat(16_385),
      }),
    ).toThrow(/too large/);
    expect(() =>
      createOrganizationsClient({
        config: { ...CONFIG, appSlug: "" },
        token: TOKEN,
      }),
    ).toThrow(/appSlug/);
  });

  it("rejects the generic OIDC provider", () => {
    expect(() =>
      createOrganizationsClient({
        config: { ...CONFIG, provider: "oidc" },
        token: TOKEN,
      }),
    ).toThrow(/only available for auth-service/);
  });

  it("rejects an insecure issuer", () => {
    expect(() =>
      createOrganizationsClient({
        config: { ...CONFIG, issuer: "http://auth.example.com" },
        token: TOKEN,
      }),
    ).toThrow(/must use https/);
  });
});
