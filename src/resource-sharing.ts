/**
 * Self-service resource sharing client for auth-service: grants, application
 * shares and permanent deletion, on behalf of the signed-in user.
 *
 * @version 0.6.0
 * @since 0.6.0
 */

import type { ResourceSharingClient } from "@circle-rd/auth-ai";
import { createUserAi } from "./user-ai.js";
import type { UserTokenOptions } from "./user-ai.js";

export interface AuthServiceResourceSharingOptions extends UserTokenOptions {
  /** User access token for the auth-service audience with `resources:self:manage`. */
  readonly token: string;
}

/**
 * Create the signed-in user's `ResourceSharingClient` from the access token
 * already verified by `OidcHttpMiddleware` or `OidcSocketMiddleware`.
 *
 * The token must be minted for the auth-service audience and carry
 * `resources:self:manage` (`RESOURCE_SELF_SCOPE`). A bearer token is confined
 * to the application of its client: the client sees and shares only the
 * resources of that application. auth-service remains the decision point.
 */
export function createResourceSharingClient(
  options: AuthServiceResourceSharingOptions,
): ResourceSharingClient {
  return createUserAi(options, "Resource sharing").resources;
}
