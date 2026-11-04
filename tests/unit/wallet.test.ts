import { describe, it, expect, vi } from "vitest";
import { MICRO_PER_EUR, createWalletClient } from "../../src/wallet.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const account = {
  balance: "5000000",
  isUnlimited: false,
  canSpend: true,
  currency: "eur",
};

describe("AuthServiceWalletClient", () => {
  it("reads the wallet and returns exact micro-euro amounts", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(account));
    const wallet = createWalletClient({
      authServiceUrl: "https://auth.example.com/",
      token: "wallet-token",
      fetch: fetchMock as typeof fetch,
    });

    const result = await wallet.getAccount();

    expect(result.balance).toBe(5_000_000n);
    expect(result.balance / MICRO_PER_EUR).toBe(5n);
    expect(wallet.topupUrl()).toBe("https://auth.example.com/profile");
    const request = fetchMock.mock.calls[0]?.[0] as URL;
    expect(request.href).toBe("https://auth.example.com/api/user/wallet");
  });

  it("sends query parameters for stats and transactions", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        days: 30,
        total: "0",
        notBilled: "0",
        calls: 0,
        series: [],
        byApplication: [],
        byKind: [],
        byModel: [],
        daily: [],
      }),
    );
    const wallet = createWalletClient({
      authServiceUrl: "https://auth.example.com",
      token: "wallet-token",
      fetch: fetchMock as typeof fetch,
    });

    await wallet.getStats({ days: 7 });
    const statsUrl = fetchMock.mock.calls[0]?.[0] as URL;
    expect(statsUrl.searchParams.get("days")).toBe("7");

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ items: [], nextCursor: null }),
    );
    await wallet.listTransactions({ limit: 10, cursor: "cur", type: "usage" });
    const txUrl = fetchMock.mock.calls[1]?.[0] as URL;
    expect(txUrl.searchParams.get("limit")).toBe("10");
    expect(txUrl.searchParams.get("cursor")).toBe("cur");
    expect(txUrl.searchParams.get("type")).toBe("usage");
  });

  it("reads top-up options and session usage", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("topup-options")) {
        return jsonResponse({
          enabled: true,
          currency: "eur",
          minCents: 500,
          maxCents: 50000,
        });
      }
      return jsonResponse({
        sessionId: "s-1",
        applicationSlug: "my-app",
        days: 30,
        total: "100",
        notBilled: "0",
        calls: 1,
        byModel: [],
      });
    });
    const wallet = createWalletClient({
      authServiceUrl: "https://auth.example.com",
      token: "wallet-token",
      fetch: fetchMock as typeof fetch,
    });

    await expect(wallet.getTopupOptions()).resolves.toMatchObject({
      enabled: true,
      minCents: 500,
    });
    await expect(
      wallet.getSessionUsage("s-1", { days: 10 }),
    ).resolves.toMatchObject({
      sessionId: "s-1",
      total: 100n,
    });
    const usageUrl = fetchMock.mock.calls[1]?.[0] as URL;
    expect(usageUrl.searchParams.get("sessionId")).toBe("s-1");
    expect(usageUrl.searchParams.get("days")).toBe("10");
  });

  it("maps HTTP and schema errors to auth-ai error codes", async () => {
    const denied = createWalletClient({
      authServiceUrl: "https://auth.example.com",
      token: "wallet-token",
      fetch: (async () => jsonResponse({}, 403)) as typeof fetch,
    });
    await expect(denied.getAccount()).rejects.toMatchObject({
      code: "API_001",
    });

    const invalid = createWalletClient({
      authServiceUrl: "https://auth.example.com",
      token: "wallet-token",
      fetch: (async () => jsonResponse({ balance: "nope" })) as typeof fetch,
    });
    await expect(invalid.getAccount()).rejects.toMatchObject({
      code: "API_002",
    });

    const notJson = createWalletClient({
      authServiceUrl: "https://auth.example.com",
      token: "wallet-token",
      fetch: (async () =>
        new Response("not json", { status: 200 })) as typeof fetch,
    });
    await expect(notJson.getAccount()).rejects.toMatchObject({
      code: "API_002",
    });
  });

  it("maps a network failure to API_001", async () => {
    const wallet = createWalletClient({
      authServiceUrl: "https://auth.example.com",
      token: "wallet-token",
      fetch: (async () => {
        throw new Error("ECONNREFUSED");
      }) as typeof fetch,
    });

    await expect(wallet.getAccount()).rejects.toMatchObject({
      code: "API_001",
    });
  });

  it("validates its configuration", () => {
    expect(() =>
      createWalletClient({ authServiceUrl: "", token: "t" }),
    ).toThrow(/authServiceUrl/);
    expect(() =>
      createWalletClient({
        authServiceUrl: "https://auth.example.com",
        token: "",
      }),
    ).toThrow(/access token/);
    const wallet = createWalletClient({
      authServiceUrl: "https://auth.example.com",
      token: "t",
    });
    expect(() => wallet.getSessionUsage("")).toThrow(/sessionId/);
  });
});

describe("AuthServiceWalletClient — default fetch", () => {
  it("uses the global fetch when none is provided", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(account));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const wallet = createWalletClient({
        authServiceUrl: "https://auth.example.com",
        token: "wallet-token",
      });
      await expect(wallet.getAccount()).resolves.toMatchObject({
        balance: 5_000_000n,
      });
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
