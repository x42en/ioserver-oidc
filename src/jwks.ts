import * as jose from "jose";
import { ASYMMETRIC_ALGORITHMS, isAsymmetricAlgorithm } from "./algorithms.js";
import { DEFAULT_CLAIM_MAPPING } from "./claims.js";
import { OidcTokenError } from "./errors.js";
import type {
  OidcClaimMapping,
  OidcConfig,
  OidcFeatures,
  OidcUserContext,
} from "./types.js";

/**
 * In-process JWKS cache.
 * Keyed by the fully-qualified JWKS URI so multiple apps / instances running in
 * the same process each maintain their own cached key set.
 */
const jwksCache = new Map<string, ReturnType<typeof jose.createRemoteJWKSet>>();

function providerOf(config: OidcConfig): "auth-service" | "oidc" {
  return config.provider ?? "auth-service";
}

/** Return the JWKS URI for the given config. */
function resolveJwksUri(config: OidcConfig): string {
  if (config.jwksUri) return config.jwksUri;
  const base = config.authServiceUrl.replace(/\/$/, "");
  return providerOf(config) === "auth-service"
    ? `${base}/api/auth/jwks`
    : `${base}/.well-known/jwks.json`;
}

/** Return the issuer string for the given config. */
function resolveIssuer(config: OidcConfig): string {
  if (config.issuer !== undefined) return config.issuer;
  return providerOf(config) === "auth-service"
    ? config.authServiceUrl.replace(/\/$/, "")
    : config.authServiceUrl;
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

function stringClaim(
  payload: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = payload[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArrayClaim(
  payload: Record<string, unknown>,
  name: string,
): string[] {
  const value = payload[name];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function objectClaim(
  payload: Record<string, unknown>,
  name: string,
): OidcFeatures {
  const value = payload[name];
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as OidcFeatures)
    : {};
}

function resolveAlgorithms(config: OidcConfig): string[] {
  const requested = config.algorithms ?? ASYMMETRIC_ALGORITHMS;
  const accepted = requested.filter(isAsymmetricAlgorithm);
  if (accepted.length === 0) {
    throw new Error(
      "[ioserver-oidc] No asymmetric JWS algorithm is configured.",
    );
  }
  return [...accepted];
}

function authorizedPartyOf(
  payload: Record<string, unknown>,
  claims: OidcClaimMapping,
): string | undefined {
  for (const claim of claims.authorizedParty) {
    const value = stringClaim(payload, claim);
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Verify an OIDC/OAuth2 JWT access token.
 *
 * 1. Resolves the JWKS URI and issuer from `config`.
 * 2. Verifies the signature against the cached remote JWKS, restricting
 *    accepted algorithms to an asymmetric allow-list.
 * 3. Validates `iss`, expiry, `aud`, and the authorized party
 *    (`azp` / `client_id`) against `appSlug`.
 * 4. Maps standard + custom claims to `OidcUserContext`.
 *
 * Throws a `jose` `JWTVerifyError` (or subclass) on signature/claim failure,
 * and `OidcTokenError` when a `client_credentials` token is refused.
 */
export async function verifyOidcToken(
  token: string,
  config: OidcConfig,
): Promise<OidcUserContext> {
  if (token.length === 0 || token.length > 16_384) {
    throw new OidcTokenError(
      "ERR_AUTH_TOKEN_INVALID",
      "access token is empty or exceeds the maximum accepted size",
    );
  }

  const claims = config.claims ?? DEFAULT_CLAIM_MAPPING;
  const jwksUri = resolveJwksUri(config);
  const issuer = resolveIssuer(config);
  const keyset = getJwks(jwksUri);

  // auth-service issues a JWT for an RFC 8707 resource; legacy deployments
  // used the client_id as the audience. Generic providers choose explicitly.
  const audience = config.audience ?? config.appSlug;

  const { payload, protectedHeader } = await jose.jwtVerify(token, keyset, {
    issuer,
    audience,
    algorithms: resolveAlgorithms(config),
    clockTolerance: config.clockToleranceSeconds ?? 5,
    requiredClaims: ["exp", "iss", "aud", "sub"],
    ...(config.tokenType ? { typ: config.tokenType } : {}),
  });

  const p = payload as Record<string, unknown>;

  const typ =
    typeof protectedHeader?.typ === "string"
      ? protectedHeader.typ.toLowerCase()
      : undefined;
  if (typ === "logout+jwt" || typ === "id+jwt") {
    throw new jose.errors.JWTClaimValidationFailed(
      'unexpected "typ" (token type) header',
      payload,
      "typ",
      "check_failed",
    );
  }

  if (
    typeof p["token_use"] === "string" &&
    p["token_use"].toLowerCase() !== "access"
  ) {
    throw new jose.errors.JWTClaimValidationFailed(
      'invalid "token_use" claim',
      payload,
      "token_use",
      "check_failed",
    );
  }

  for (const marker of ["nonce", "at_hash", "c_hash"]) {
    if (p[marker] !== undefined) {
      throw new jose.errors.JWTClaimValidationFailed(
        `unexpected "${marker}" claim on an access token`,
        payload,
        marker,
        "check_failed",
      );
    }
  }

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
  const authorizedParty = authorizedPartyOf(p, claims);

  const audienceIsResource =
    config.audience !== undefined && config.audience !== config.appSlug;

  if (authorizedParty === undefined) {
    if (audienceIsResource && config.appSlug) {
      throw new jose.errors.JWTClaimValidationFailed(
        'missing "azp" (authorized party) claim',
        payload,
        "azp",
        "missing",
      );
    }
  } else if (config.appSlug && authorizedParty !== config.appSlug) {
    throw new jose.errors.JWTClaimValidationFailed(
      'unexpected "azp" (authorized party) claim',
      payload,
      "azp",
      "check_failed",
    );
  }

  // `jwtVerify` only checks that `sub` is present; enforce the string shape.
  const sub = payload.sub;
  if (typeof sub !== "string" || sub.length === 0) {
    throw new jose.errors.JWTClaimValidationFailed(
      'invalid "sub" claim',
      payload,
      "sub",
      "check_failed",
    );
  }

  // A client_credentials token has no end user: the subject is the client.
  // The same rule applies to native and generic providers.
  const isMachine = authorizedParty !== undefined && sub === authorizedParty;

  if (isMachine && config.allowMachineTokens !== true) {
    throw new OidcTokenError(
      "ERR_MACHINE_TOKEN_FORBIDDEN",
      "client_credentials tokens are not accepted for user authentication",
    );
  }

  const roles = stringArrayClaim(p, claims.roles);
  const permissions = stringArrayClaim(p, claims.permissions);
  const features = objectClaim(p, claims.features);
  const plan = stringClaim(p, claims.plan);
  const sid = stringClaim(p, "sid");
  const scope = stringClaim(p, "scope");
  const email = stringClaim(p, claims.email) ?? null;
  const name = stringClaim(p, claims.name) ?? null;
  const picture = stringClaim(p, claims.picture) ?? null;
  const company = stringClaim(p, claims.company) ?? null;
  const emailVerified =
    typeof p["email_verified"] === "boolean" ? p["email_verified"] : undefined;

  const ctx: OidcUserContext = {
    userId: sub, // replaced by the local DB id after findOrCreate in middleware
    sub,
    email,
    name,
    userRole: roles[0] ?? "user",
    roles,
    permissions,
    features,
  };
  if (emailVerified !== undefined) ctx.emailVerified = emailVerified;
  if (picture !== null) ctx.picture = picture;
  if (company !== null) ctx.company = company;
  if (plan !== undefined) ctx.plan = plan;
  if (sid !== undefined) ctx.sid = sid;
  if (authorizedParty !== undefined) ctx.clientId = authorizedParty;
  if (scope !== undefined) ctx.scopes = scope.split(" ").filter(Boolean);
  const audValue = p["aud"];
  const audiences =
    typeof audValue === "string"
      ? [audValue]
      : Array.isArray(audValue)
        ? audValue.filter((item): item is string => typeof item === "string")
        : [];
  if (audiences.length > 0) ctx.audiences = audiences;
  if (isMachine) ctx.isMachine = true;
  const orgId = stringClaim(p, claims.orgId);
  if (orgId !== undefined) ctx.org_id = orgId;
  return ctx;
}
