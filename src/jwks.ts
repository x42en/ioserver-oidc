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
 * Verify an OIDC/OAuth2 JWT access token issued by auth-service.
 *
 * 1. Resolves the JWKS URI and issuer from `config`.
 * 2. Verifies the RS/EC signature against the cached remote JWKS.
 * 3. Validates `iss`, expiry, `azp` (authorized party) against `appSlug`.
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
  });

  const p = payload as Record<string, unknown>;

  // `sub` is guaranteed by jwtVerify (it checks for its presence)
  const sub = payload.sub as string;

  const roles = Array.isArray(p["roles"]) ? (p["roles"] as string[]) : [];

  const permissions = Array.isArray(p["permissions"])
    ? (p["permissions"] as string[])
    : [];

  const features: OidcFeatures =
    p["features"] != null && typeof p["features"] === "object"
      ? (p["features"] as OidcFeatures)
      : {};

  // Primary role: first element of the roles array, fallback "user"
  const userRole = roles[0] ?? "user";

  return {
    userId: sub, // will be replaced by DB id after findOrCreate in middleware
    sub,
    email: typeof p["email"] === "string" ? p["email"] : null,
    name: typeof p["name"] === "string" ? p["name"] : null,
    userRole,
    roles,
    permissions,
    features,
  };
}
