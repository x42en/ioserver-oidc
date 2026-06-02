import * as jose from "jose";
import type { OidcConfig, OidcUserContext, OidcFeatures } from "./types.js";

/**
 * In-process JWKS cache.
 * Keyed by the fully-qualified JWKS URI so multiple apps / instances running in
 * the same process each maintain their own cached key set.
 */
const jwksCache = new Map<string, ReturnType<typeof jose.createRemoteJWKSet>>();

/**
 * Return the JWKS URI for the given config.
 * Prefers an explicit `jwksUri` override; falls back to the standard path.
 */
function resolveJwksUri(config: OidcConfig): string {
  if (config.jwksUri) return config.jwksUri;
  const base = config.authServiceUrl.replace(/\/$/, "");
  return `${base}/api/auth/jwks`;
}

/**
 * Return the issuer string for the given config.
 * Must match the `iss` claim in the JWT.
 */
function resolveIssuer(config: OidcConfig): string {
  if (config.issuer) return config.issuer;
  return config.authServiceUrl.replace(/\/$/, "");
}

/**
 * Lazily create (and cache) a `jose` Remote JWKS keyset for the given URI.
 * The jose library handles in-memory key caching and automatic refresh
 * (honours `Cache-Control` / 5-minute minimum TTL by default).
 */
function getJwks(jwksUri: string): ReturnType<typeof jose.createRemoteJWKSet> {
  let keyset = jwksCache.get(jwksUri);
  if (!keyset) {
    keyset = jose.createRemoteJWKSet(new URL(jwksUri));
    jwksCache.set(jwksUri, keyset);
  }
  return keyset;
}

/**
 * Default allow-list of asymmetric JWS algorithms.
 * Symmetric (`HS*`) and `none` are excluded to prevent algorithm-confusion.
 */
const DEFAULT_ALGORITHMS = [
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA",
] as const;

/**
 * Verify an OIDC/OAuth2 JWT access token issued by auth-service.
 *
 * 1. Resolves the JWKS URI and issuer from `config`.
 * 2. Verifies the RS/EC signature against the cached remote JWKS, restricting
 *    accepted algorithms to an asymmetric allow-list.
 * 3. Validates `iss`, expiry, `aud`, and the authorized party
 *    (`azp` / `client_id`) against `appSlug`.
 * 4. Maps standard + custom claims to `OidcUserContext`.
 *
 * Throws a `jose` `JWTVerifyError` (or subclass) on any failure.
 */
export async function verifyOidcToken(
  token: string,
  config: OidcConfig,
): Promise<OidcUserContext> {
  const jwksUri = resolveJwksUri(config);
  const issuer = resolveIssuer(config);
  const keyset = getJwks(jwksUri);

  // `audience` resolution:
  //  - New @better-auth/oauth-provider (v1.5+): aud = `resource` URL sent
  //    during the auth request (RFC 8707). Use config.audience (set via
  //    AUTH_SERVICE_AUDIENCE env var).
  //  - Legacy oidc-provider plugin: aud = client_id (= appSlug). Falls back
  //    to config.appSlug when config.audience is not set.
  const audience = config.audience ?? config.appSlug;

  const { payload } = await jose.jwtVerify(token, keyset, {
    issuer,
    audience,
    algorithms: (config.algorithms as string[] | undefined) ?? [
      ...DEFAULT_ALGORITHMS,
    ],
  });

  const p = payload as Record<string, unknown>;

  // ── Authorized-party binding (confused-deputy / cross-app defence) ────────
  //
  // auth-service hosts many applications over a SHARED user pool, and the
  // `roles` / `permissions` claims are scoped PER APPLICATION. When the
  // audience is a shared resource URL (RFC 8707 mode), the `aud` claim no
  // longer distinguishes the issuing client — a token minted for app B would
  // otherwise be accepted by app A and grant app-B-scoped privileges here.
  //
  // We therefore bind the token to this application via the authorized party:
  //   - `azp` (OIDC) or `client_id` (OAuth2) MUST equal `appSlug` when present.
  //   - In resource-audience mode, the party claim MUST be present.
  const authorizedParty =
    typeof p["azp"] === "string"
      ? (p["azp"] as string)
      : typeof p["client_id"] === "string"
        ? (p["client_id"] as string)
        : undefined;

  const audienceIsResource =
    config.audience !== undefined && config.audience !== config.appSlug;

  if (authorizedParty === undefined) {
    if (audienceIsResource) {
      throw new jose.errors.JWTClaimValidationFailed(
        'missing "azp" (authorized party) claim',
        payload,
        "azp",
        "missing",
      );
    }
  } else if (authorizedParty !== config.appSlug) {
    throw new jose.errors.JWTClaimValidationFailed(
      'unexpected "azp" (authorized party) claim',
      payload,
      "azp",
      "check_failed",
    );
  }

  // `sub` is guaranteed by jwtVerify (it checks for its presence)
  const sub = payload.sub as string;

  // Strictly keep only string elements — a malformed claim (e.g. numbers or
  // objects) must not leak into role/permission checks downstream.
  const roles = Array.isArray(p["roles"])
    ? (p["roles"] as unknown[]).filter(
        (r): r is string => typeof r === "string",
      )
    : [];

  const permissions = Array.isArray(p["permissions"])
    ? (p["permissions"] as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : [];

  const features: OidcFeatures =
    p["features"] != null && typeof p["features"] === "object"
      ? (p["features"] as OidcFeatures)
      : {};

  // Primary role: first element of the roles array, fallback "user"
  const userRole = roles[0] ?? "user";

  const org_id = typeof p["org_id"] === "string" ? p["org_id"] : undefined;

  const ctx: OidcUserContext = {
    userId: sub, // will be replaced by DB id after findOrCreate in middleware
    sub,
    email: typeof p["email"] === "string" ? p["email"] : null,
    name: typeof p["name"] === "string" ? p["name"] : null,
    userRole,
    roles,
    permissions,
    features,
  };
  if (org_id !== undefined) ctx.org_id = org_id;
  return ctx;
}
