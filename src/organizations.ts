/**
 * Self-service team/organization client for auth-service.
 *
 * @version 0.5.0
 * @since 0.5.0
 */

import type { OrganizationsClient } from "@circle-rd/auth-ai";
import { createUserAi } from "./user-ai.js";
import type { UserTokenOptions } from "./user-ai.js";

export interface AuthServiceOrganizationsOptions extends UserTokenOptions {
  /** User access token for the auth-service audience with `organizations:self:manage`. */
  readonly token: string;
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
  return createUserAi(options, "Organizations").organizations;
}
