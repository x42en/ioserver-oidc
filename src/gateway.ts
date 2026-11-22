import { GatewayClient } from "@circle-rd/auth-ai";
import { assertHttpUrl, isInsecureHttpAllowed } from "./url.js";
import type { OidcConfig } from "./types.js";

export {
  AuthAiError,
  GatewayClient,
  isInsufficientCredit,
  isInsufficientCreditStatus,
  toGatewayError,
} from "@circle-rd/auth-ai";
export type {
  GatewayAgent,
  GatewayClientOptions,
  GatewayMcpServer,
  GatewayModel,
  GatewayTokens,
} from "@circle-rd/auth-ai";

export interface AuthServiceGatewayOptions {
  /** Public URL of the LiteLLM gateway (the token audience). */
  readonly gatewayUrl: string;
  /** The user's access token, minted for the gateway audience. */
  readonly token: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  /** Allow plain HTTP for a controlled non-loopback development service. */
  readonly allowInsecureHttp?: boolean;
}

export interface RequestGatewayOptions {
  /** Allow plain HTTP for a controlled non-loopback development service. */
  readonly allowInsecureHttp?: boolean;
}

/**
 * Build a LiteLLM gateway client from the bearer token of the current request.
 *
 * The token must have been minted for the gateway audience
 * (`resource=<gatewayUrl>`), with no trailing slash. The gateway debits the
 * user's wallet after each call; this client never debits anything itself.
 */
export function createGatewayClient(
  options: AuthServiceGatewayOptions,
): GatewayClient {
  const gatewayUrl = assertHttpUrl(
    options.gatewayUrl.replace(/\/$/, ""),
    "gatewayUrl",
    isInsecureHttpAllowed(options.allowInsecureHttp),
  );
  return new GatewayClient({
    gatewayUrl,
    tokens: {
      getToken: () => Promise.resolve(options.token),
      invalidate: () => {
        // A static request token cannot be refreshed here; ask the caller to
        // mint a new one and rebuild the client.
      },
    },
    fetch: options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    timeoutMs: options.timeoutMs ?? 10_000,
  });
}

/**
 * Build a gateway client from the `authToken` injected by the middleware and
 * the configured `gatewayUrl`. Throws when either is missing.
 */
export function createRequestGatewayClient(
  request: { authToken?: unknown },
  config: Pick<OidcConfig, "gatewayUrl">,
  options: RequestGatewayOptions = {},
): GatewayClient {
  if (typeof request.authToken !== "string" || request.authToken.length === 0) {
    throw new Error(
      "[ioserver-oidc] No authenticated token on the request; place OidcHttpMiddleware before this route.",
    );
  }
  if (!config.gatewayUrl) {
    throw new Error(
      "[ioserver-oidc] AUTH_SERVICE_GATEWAY_URL is not configured.",
    );
  }
  return createGatewayClient({
    gatewayUrl: config.gatewayUrl,
    token: request.authToken,
    ...(options.allowInsecureHttp === undefined
      ? {}
      : { allowInsecureHttp: options.allowInsecureHttp }),
  });
}
