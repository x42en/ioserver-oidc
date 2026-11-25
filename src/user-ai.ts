/**
 * Builds an auth-ai user client from an access token the middleware already verified.
 *
 * @version 0.6.0
 * @since 0.6.0
 */

import { createAiClient, createAuthClient } from "@circle-rd/auth-ai";
import type { UserAi } from "@circle-rd/auth-ai";
import { assertHttpUrl, joinUrl } from "./url.js";
import type { OidcConfig } from "./types.js";

const MAX_TOKEN_LENGTH = 16_384;

export interface UserTokenOptions {
  /** OIDC configuration: issuer/auth-service URL and client id. */
  readonly config: Pick<
    OidcConfig,
    "authServiceUrl" | "appSlug" | "issuer" | "provider"
  >;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/**
 * `feature` names the capability in error messages. The token is forwarded as
 * is: OIDC verifies it and auth-service stays the decision point.
 */
export function createUserAi(
  options: UserTokenOptions & { readonly token: string },
  feature: string,
): UserAi {
  if (typeof options.token !== "string" || options.token.length === 0) {
    throw new Error("[ioserver-oidc] A user access token is required.");
  }
  if (options.token.length > MAX_TOKEN_LENGTH) {
    throw new Error("[ioserver-oidc] The user access token is too large.");
  }
  if (options.config.provider === "oidc") {
    throw new Error(
      `[ioserver-oidc] ${feature} are only available for auth-service.`,
    );
  }
  if (!options.config.appSlug) {
    throw new Error(
      `[ioserver-oidc] appSlug (client id) is required for ${feature.toLowerCase()}.`,
    );
  }

  const issuer = assertHttpUrl(
    options.config.issuer ?? options.config.authServiceUrl,
    "issuer",
  );

  const auth = createAuthClient(
    {
      issuer,
      clientId: options.config.appSlug,
      redirectUri: joinUrl(issuer, "__ioserver_oidc_user_client"),
      ...(options.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
    },
    options.fetch === undefined ? {} : { fetch: options.fetch },
  );

  const ai = createAiClient({
    auth,
    grants: {
      getAccessToken: async () => ({
        accessToken: options.token,
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      }),
      invalidate: () => {},
    },
  });

  return ai.forUser("ioserver-oidc");
}
