/**
 * Self-service team/organization client for auth-service.
 *
 * @version 0.5.0
 * @since 0.5.0
 */

import { createAiClient, createAuthClient } from "@circle-rd/auth-ai";
import type { OrganizationsClient } from "@circle-rd/auth-ai";
import { assertHttpUrl, joinUrl } from "./url.js";
import type { OidcConfig } from "./types.js";

export interface AuthServiceOrganizationsOptions {
  /** OIDC configuration: issuer/auth-service URL and client id. */
  readonly config: Pick<
    OidcConfig,
    "authServiceUrl" | "appSlug" | "issuer" | "provider"
  >;
  /** User access token for the auth-service audience with `organizations:self:manage`. */
  readonly token: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/**
 * Create the signed-in user's `OrganizationsClient` from the access token
 * already verified by `OidcHttpMiddleware` or `OidcSocketMiddleware`.
 *
 * The token must be minted for the auth-service audience and carry
 * `organizations:self:manage` (`ORGANIZATION_SELF_SCOPE`). OIDC verifies and
 * forwards the token; auth-service remains the decision point.
 */
export function createOrganizationsClient(
  options: AuthServiceOrganizationsOptions,
): OrganizationsClient {
  if (typeof options.token !== "string" || options.token.length === 0) {
    throw new Error("[ioserver-oidc] A user access token is required.");
  }
  if (options.token.length > 16_384) {
    throw new Error("[ioserver-oidc] The user access token is too large.");
  }
  if (options.config.provider === "oidc") {
    throw new Error(
      "[ioserver-oidc] Organizations are only available for auth-service.",
    );
  }
  if (!options.config.appSlug) {
    throw new Error(
      "[ioserver-oidc] appSlug (client id) is required for the organizations client.",
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
      redirectUri: joinUrl(issuer, "__ioserver_oidc_organizations"),
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

  return ai.forUser("ioserver-oidc").organizations;
}
