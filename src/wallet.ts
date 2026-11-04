import { z } from "zod";
import { ERR } from "@circle-rd/auth-ai";

/** 1 EUR in the ledger unit. */
export const MICRO_PER_EUR = 1_000_000n;

const amountSchema = z
  .string()
  .regex(/^-?[0-9]{1,19}$/, "must be an integer string of micro-euros")
  .transform((value) => BigInt(value));

const walletAccountSchema = z.object({
  balance: amountSchema,
  isUnlimited: z.boolean(),
  canSpend: z.boolean(),
  currency: z.literal("eur"),
});

const walletTransactionSchema = z.object({
  id: z.string(),
  type: z.enum(["topup", "grant", "refund", "usage", "adjust", "reversal"]),
  amount: amountSchema,
  delta: amountSchema,
  balanceAfter: amountSchema,
  applicationId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});

const walletTransactionPageSchema = z.object({
  items: z.array(walletTransactionSchema),
  nextCursor: z.string().nullable(),
});

const modelEntrySchema = z.object({
  model: z.string(),
  amount: amountSchema,
  count: z.number(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  totalTokens: z.number(),
});

const applicationEntrySchema = z.object({
  applicationId: z.string().nullable(),
  name: z.string().nullable(),
  slug: z.string().nullable(),
  amount: amountSchema,
  count: z.number(),
});

const walletStatsSchema = z.object({
  days: z.number(),
  total: amountSchema,
  notBilled: amountSchema,
  calls: z.number(),
  series: z.array(
    z.object({ date: z.string(), amount: amountSchema, count: z.number() }),
  ),
  byApplication: z.array(applicationEntrySchema),
  byKind: z.array(
    z.object({ kind: z.string(), amount: amountSchema, count: z.number() }),
  ),
  byModel: z.array(modelEntrySchema),
  daily: z.array(
    z.object({
      date: z.string(),
      amount: amountSchema,
      count: z.number(),
      byApplication: z.array(applicationEntrySchema),
      byModel: z.array(modelEntrySchema),
    }),
  ),
});

const walletSessionUsageSchema = z.object({
  sessionId: z.string(),
  applicationSlug: z.string().nullable(),
  days: z.number(),
  total: amountSchema,
  notBilled: amountSchema,
  calls: z.number(),
  byModel: z.array(modelEntrySchema),
});

const topupOptionsSchema = z.object({
  enabled: z.boolean(),
  currency: z.literal("eur"),
  minCents: z.number(),
  maxCents: z.number(),
});

export type WalletAccount = z.infer<typeof walletAccountSchema>;
export type WalletTransaction = z.infer<typeof walletTransactionSchema>;
export type WalletTransactionPage = z.infer<typeof walletTransactionPageSchema>;
export type WalletTransactionType = WalletTransaction["type"];
export type WalletStats = z.infer<typeof walletStatsSchema>;
export type WalletSessionUsage = z.infer<typeof walletSessionUsageSchema>;
export type TopupOptions = z.infer<typeof topupOptionsSchema>;

export interface AuthServiceWalletOptions {
  /** Public base URL of auth-service (`BETTER_AUTH_URL`). */
  readonly authServiceUrl: string;
  /** A user token minted for the auth-service audience. */
  readonly token: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface WalletStatsOptions {
  /** 1 to 90 days, 30 by default. */
  readonly days?: number;
}

export interface WalletSessionUsageOptions {
  /** 1 to 90 days, 30 by default. */
  readonly days?: number;
}

export interface ListTransactionsOptions {
  readonly limit?: number;
  readonly cursor?: string;
  readonly type?: WalletTransactionType;
}

/**
 * Read the signed-in user's auth-service credit wallet with a user token
 * carrying the `wallet:self:read` scope.
 *
 * Debits are made by the LiteLLM gateway after each call; this client only
 * reads, and links to the profile page for a top-up.
 */
export class AuthServiceWalletClient {
  readonly #baseUrl: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: AuthServiceWalletOptions) {
    if (!options.authServiceUrl) {
      throw ERR.CFG_001("authServiceUrl is required");
    }
    if (!options.token) {
      throw ERR.CFG_001("A user access token is required");
    }
    this.#baseUrl = options.authServiceUrl.replace(/\/$/, "");
    this.#token = options.token;
    this.#fetch =
      options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#timeoutMs = options.timeoutMs ?? 10_000;
  }

  /** Decide with `canSpend`, not by recomputing it from `balance`. */
  getAccount(): Promise<WalletAccount> {
    return this.#request("/api/user/wallet", walletAccountSchema);
  }

  getStats(options: WalletStatsOptions = {}): Promise<WalletStats> {
    return this.#request("/api/user/wallet/stats", walletStatsSchema, {
      days: options.days,
    });
  }

  /** What one chat session spent, scoped to the calling application. */
  getSessionUsage(
    sessionId: string,
    options: WalletSessionUsageOptions = {},
  ): Promise<WalletSessionUsage> {
    if (!sessionId) throw ERR.CFG_001("sessionId is required");
    return this.#request("/api/user/wallet/usage", walletSessionUsageSchema, {
      sessionId,
      days: options.days,
    });
  }

  /** Newest first; pass `nextCursor` back until it is null. */
  listTransactions(
    options: ListTransactionsOptions = {},
  ): Promise<WalletTransactionPage> {
    return this.#request(
      "/api/user/wallet/transactions",
      walletTransactionPageSchema,
      { limit: options.limit, cursor: options.cursor, type: options.type },
    );
  }

  getTopupOptions(): Promise<TopupOptions> {
    return this.#request("/api/user/wallet/topup-options", topupOptionsSchema);
  }

  /** Credit tab of the user's auth-service profile (checkout needs a session). */
  topupUrl(): string {
    return `${this.#baseUrl}/profile`;
  }

  async #request<T>(
    path: string,
    schema: z.ZodType<T>,
    query: Record<string, string | number | undefined> = {},
  ): Promise<T> {
    const url = new URL(`${this.#baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.#token}`,
        },
        redirect: "error",
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (cause) {
      throw ERR.API_001("auth-service request failed", {
        cause,
        details: { path },
      });
    }

    if (!response.ok) {
      throw ERR.API_001(`auth-service answered ${response.status}`, {
        details: { status: response.status, path },
      });
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw ERR.API_002(undefined, { cause });
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw ERR.API_002(undefined, { cause: parsed.error });
    }
    return parsed.data;
  }
}

export function createWalletClient(
  options: AuthServiceWalletOptions,
): AuthServiceWalletClient {
  return new AuthServiceWalletClient(options);
}
