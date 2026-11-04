/**
 * Shared types for the ioserver-oidc package.
 *
 * The package supports two token providers:
 *  - `auth-service` (default): the CIRCLE auth-service access-token format,
 *    including RBAC, plan features, organizations and LiteLLM audiences.
 *  - `oidc`: any standards-compliant OAuth 2.x / OIDC JWT issuer, with
 *    configurable claim names.
 */

/** Token provider selected by `OIDC_PROVIDER`. */
export type OidcProvider = "auth-service" | "oidc";

/**
 * Feature flags and resource limits decoded from the `features` JWT claim.
 * The shape is application-defined — cast to a more specific type in your app.
 */
export type OidcFeatures = Record<string, unknown>;

/**
 * Claim names used to build the user context. Defaults match auth-service and
 * the common OIDC providers; override them for providers that use other names.
 */
export interface OidcClaimMapping {
  /** Claim holding the user's role names. Default: `roles`. */
  readonly roles: string;
  /** Claim holding permission strings. Default: `permissions`. */
  readonly permissions: string;
  /** Claim holding feature flags. Default: `features`. */
  readonly features: string;
  /** Claim holding the subscription plan name. Default: `plan`. */
  readonly plan: string;
  /** Claim holding the organization id. Default: `org_id`. */
  readonly orgId: string;
  /** Claim holding the e-mail address. Default: `email`. */
  readonly email: string;
  /** Claim holding the display name. Default: `name`. */
  readonly name: string;
  /** Claim holding the profile picture URL. Default: `picture`. */
  readonly picture: string;
  /** Claim holding the company name. Default: `company`. */
  readonly company: string;
  /** Claims that may carry the authorized party (client id). Default: `azp`, `client_id`. */
  readonly authorizedParty: readonly string[];
}

/**
 * Runtime configuration for the OIDC middleware set.
 * Typically provided by `OidcConfigManager` via `appHandle.oidcConfig`.
 */
export interface OidcConfig {
  /**
   * Token provider. Defaults to `auth-service` so existing auth-service
   * deployments keep working without a new environment variable.
   */
  readonly provider?: OidcProvider;

  /**
   * Public base URL of the auth-service instance (native mode), or the issuer
   * URL (generic mode, kept for backward compatibility).
   * Example: "https://auth.example.com"
   */
  readonly authServiceUrl: string;

  /**
   * The OAuth2 `client_id` / application slug (native mode), or the expected
   * authorized party (generic mode). Used to bind tokens to this application.
   * Example: "mcp-central"
   */
  readonly appSlug: string;

  /**
   * Override the JWKS URI.
   * Native default: `<authServiceUrl>/api/auth/jwks`.
   */
  readonly jwksUri?: string;

  /**
   * Override the issuer claim to validate against.
   * Native default: `<authServiceUrl>`.
   */
  readonly issuer?: string;

  /**
   * Expected `aud` (audience) claim in JWT access tokens.
   *
   * auth-service issues a JWT only when the client sends a `resource`
   * parameter (RFC 8707); the `aud` is that resource URL. When omitted, the
   * legacy `client_id` audience (`appSlug`) is used.
   */
  readonly audience?: string;

  /**
   * Allow-list of JWS algorithms accepted when verifying the token signature.
   *
   * Defaults to the set of asymmetric algorithms commonly emitted by
   * auth-service and mainstream providers (`RS*`, `PS*`, `ES*`, `EdDSA`).
   * Symmetric algorithms (`HS*`) and `none` are intentionally excluded.
   */
  readonly algorithms?: readonly string[];

  /**
   * Accepted clock skew in seconds when checking `exp`, `nbf` and `iat`.
   * Default: `5`.
   */
  readonly clockToleranceSeconds?: number;

  /**
   * Accept `client_credentials` tokens (where `sub === azp`). Native default:
   * `false`, because such a token has no end user to provision; generic
   * default: `true`, preserving the previous behaviour.
   */
  readonly allowMachineTokens?: boolean;

  /**
   * Roles accepted by `OidcSocketAdminMiddleware`. Default: `["admin"]`.
   */
  readonly adminRoles?: readonly string[];

  /**
   * Public URL of the LiteLLM gateway. Enables `createGatewayClient()` and
   * `AUTH_SERVICE_GATEWAY_URL`-based helpers.
   */
  readonly gatewayUrl?: string;

  /**
   * Claim names used to map the token payload to `OidcUserContext`.
   * Native and generic defaults match auth-service.
   */
  readonly claims?: OidcClaimMapping;
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
   * OIDC `sub` claim — the stable identifier from the provider.
   * Maps to `users.sub` column in the local DB.
   */
  sub: string;

  /** Email address from the token. */
  email: string | null;

  /** Display name from the token. */
  name: string | null;

  /**
   * Primary role from the `roles` array claim.
   * Typically "admin" or "user".
   */
  userRole: string;

  /**
   * Full roles array from the token.
   * Empty array when the `roles` scope was not requested.
   */
  roles: string[];

  /**
   * Permission strings decoded from the token.
   * Format: "resource" or "resource.action".
   * Empty array when the `permissions` scope was not requested.
   */
  permissions: string[];

  /**
   * Feature flags and limits from the token.
   * Empty object when the `features` scope was not requested or the
   * user has no active subscription.
   */
  features: OidcFeatures;

  /**
   * Active organization ID from the token.
   * Present when the `org` scope was requested and the user has an active organization.
   */
  org_id?: string;

  /** Subscription plan name, when the provider emits one. */
  plan?: string;

  /** Provider session id (`sid`), used by back-channel logout. */
  sid?: string;

  /** OAuth client (application slug) the token was issued to. */
  clientId?: string;

  /** Granted scopes split from the `scope` claim. */
  scopes?: string[];

  /** True when the token is a `client_credentials` token (no end user). */
  isMachine?: boolean;

  /** Email verification status, when the provider emits it. */
  emailVerified?: boolean;

  /** Profile picture URL, when the provider emits one. */
  picture?: string | null;

  /** Company name, when the provider emits one. */
  company?: string | null;
}
