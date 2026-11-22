import { describe, it, expect, vi } from "vitest";
import {
  createGatewayClient,
  createRequestGatewayClient,
} from "../../src/gateway.js";

describe("gateway helpers", () => {
  it("builds an origin-locked OpenAI base URL and reuses the token", async () => {
    const client = createGatewayClient({
      gatewayUrl: "https://llm.example.com/",
      token: "user-token",
    });

    expect(client.openAiBaseUrl).toBe("https://llm.example.com/v1");
    await expect(client.getAccessToken()).resolves.toBe("user-token");
    expect(client.mcpUrl()).toBe("https://llm.example.com/mcp");
    expect(client.mcpUrl("github")).toBe("https://llm.example.com/github/mcp");
    expect(() => client.mcpUrl("bad/name")).toThrow(/Invalid MCP server name/);
  });

  it("signs gateway requests with the request token", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        expect(request.headers.get("authorization")).toBe("Bearer user-token");
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );

    const client = createGatewayClient({
      gatewayUrl: "https://llm.example.com",
      token: "user-token",
      fetch: fetchMock as typeof fetch,
    });

    await expect(client.listModels()).resolves.toEqual([]);
  });

  it("builds a client from an authenticated request", () => {
    const client = createRequestGatewayClient(
      { authToken: "user-token" },
      { gatewayUrl: "https://llm.example.com" },
    );
    expect(client.openAiBaseUrl).toBe("https://llm.example.com/v1");
  });

  it("throws when the request has no token or the gateway is not configured", () => {
    expect(() =>
      createRequestGatewayClient({}, { gatewayUrl: "https://llm.example.com" }),
    ).toThrow(/OidcHttpMiddleware/);
    expect(() =>
      createRequestGatewayClient({ authToken: "user-token" }, {}),
    ).toThrow(/AUTH_SERVICE_GATEWAY_URL/);
  });
});

describe("gateway helpers — default fetch and invalidation", () => {
  it("uses the global fetch when none is provided", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const client = createGatewayClient({
        gatewayUrl: "https://llm.example.com",
        token: "user-token",
      });
      await expect(client.listModels()).resolves.toEqual([]);
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("drops the cached token on a 401 and maps the gateway error", async () => {
    const client = createGatewayClient({
      gatewayUrl: "https://llm.example.com",
      token: "user-token",
      fetch: (async () =>
        new Response(JSON.stringify({ error: { message: "nope" } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
    });

    await expect(client.listModels()).rejects.toMatchObject({ code: "GW_003" });
  });
});

describe("gateway helpers — transport security", () => {
  it("rejects plain HTTP for non-loopback gateway URLs", () => {
    expect(() =>
      createGatewayClient({
        gatewayUrl: "http://llm.example.com",
        token: "user-token",
      }),
    ).toThrow(/must use https/);
  });

  it("rejects non-HTTP gateway schemes", () => {
    expect(() =>
      createGatewayClient({
        gatewayUrl: "javascript:alert",
        token: "user-token",
      }),
    ).toThrow(/must use http or https/);
  });

  it("accepts non-loopback HTTP only with an explicit opt-in", () => {
    expect(() =>
      createGatewayClient({
        gatewayUrl: "http://llm.example.com",
        token: "user-token",
        allowInsecureHttp: true,
      }),
    ).not.toThrow();
  });
});
