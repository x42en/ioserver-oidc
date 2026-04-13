/**
 * Shared types for the ioserver-oidc package.
 *
 * These interfaces describe the configuration passed to the middlewares
 * and the user context they inject onto the request / socket after
 * successful JWT verification.
 */

// ─── Configuration ─────────────────────────────────────────

/**
 * Feature flags and resource limits decoded from the `features` JWT claim.
 * The shape is application-defined — cast to a more specific type in your app.
 */
export type OidcFeatures = Record<string, unknown>;

/**
 * Runtime configuration for the OIDC middleware set.
 * Typically provided by `OidcConfigManager` via `appHandle.oidcConfig`.
 */
export interface OidcConfig {
  /**
   * Public base URL of the auth-service instance.
   * Used to build the issuer and JWKS URI.
   * Example: "https://auth.example.com"
   */
  readonly authServiceUrl: string;

  /**
   * The OAuth2 `client_id` / application slug registered in auth-service.
   * Used to validate the `azp` (authorized party) claim in the JWT.
   * Example: "mcp-central"
   */
  readonly appSlug: string;

  /**
   * Override the JWKS URI instead of discovering it from the well-known endpoint.
   * Defaults to `<authServiceUrl>/api/auth/jwks`.
   */
  readonly jwksUri?: string;

  /**
   * Override the issuer claim to validate against.
   * Defaults to `<authServiceUrl>`.
   */
  readonly issuer?: string;

  /**
   * Expected `aud` (audience) claim in JWT access tokens.
   *
   * With `@better-auth/oauth-provider` (v1.5+), JWTs are only issued when
   * the client sends a `resource` parameter (RFC 8707). The `aud` claim is
   * set to that resource URL — NOT to the `client_id` / appSlug.
   *
   * Set this to the public base URL of the resource server (e.g. your API),
   * matching the `resource` the frontend sends and the `validAudiences` the
   * auth-service advertises.
   *
   * When omitted, falls back to `appSlug` for backward compatibility with
   * the legacy `oidc-provider` plugin.
   *
   * Example: "https://api.example.com"
   */
  readonly audience?: string;
}

// ─── User context ────────────────────────────────────────────

/**
 * Auth context injected onto `request` (HTTP) or `socket` (WebSocket)
 * after successful JWT verification.
 */
export interface OidcUserContext {
  /** Internal user ID — matches the local user record (`users.id`). */
  userId: string;

  /**
   * OIDC `sub` claim — the stable identifier from auth-service.
   * Maps to `users.sub` column in the local DB.
   */
  sub: string;

  /** Email address from the JWT `email` claim. */
  email: string | null;

  /** Display name from the JWT `name` claim. */
  name: string | null;

  /**
   * Primary role from the `roles` array claim.
   * Typically "admin" or "user".
   */
  userRole: string;

  /**
   * Full roles array from the `roles` JWT claim.
   * Empty array when the `roles` scope was not requested.
   */
  roles: string[];

  /**
   * Permission strings decoded from the `permissions` JWT claim.
   * Format: "resource" or "resource.action".
   * Empty array when the `permissions` scope was not requested.
   */
  permissions: string[];

  /**
   * Feature flags and limits from the `features` JWT claim.
   * Empty object when the `features` scope was not requested or the
   * user has no active subscription.
   */
  features: OidcFeatures;

  /**
   * Active organization ID from the `org_id` JWT claim.
   * Present when the `org` scope was requested and the user has an active organization.
   */
  org_id?: string;
}
