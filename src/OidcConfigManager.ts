import { BaseManager } from "ioserver";
import { isAsymmetricAlgorithm } from "./algorithms.js";
import { DEFAULT_CLAIM_MAPPING } from "./claims.js";
import type { OidcClaimMapping, OidcConfig, OidcProvider } from "./types.js";

function parseProvider(value: string | undefined): OidcProvider {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "auth-service") return "auth-service";
  if (
    normalized === "oidc" ||
    normalized === "oauth2" ||
    normalized === "generic"
  ) {
    return "oidc";
  }
  throw new Error(
    `[OidcConfigManager] Unsupported OIDC_PROVIDER "${value}". Use "auth-service" or "oidc".`,
  );
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(
    `[OidcConfigManager] Invalid boolean value "${value}". Use true or false.`,
  );
}

function parseList(
  value: string | undefined,
  fallback: readonly string[],
): readonly string[] {
  if (value === undefined) return fallback;
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

function assertHttpUrl(value: string, variable: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `[OidcConfigManager] ${variable} must be an absolute URL, got "${value}".`,
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(
      `[OidcConfigManager] ${variable} must use http or https, got "${value}".`,
    );
  }
  return value;
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 300) {
    throw new Error(
      `[OidcConfigManager] Invalid OIDC_CLOCK_TOLERANCE_SECONDS "${value}". Use an integer from 0 to 300.`,
    );
  }
  return parsed;
}

function buildClaimMapping(): OidcClaimMapping {
  const env = process.env;
  return {
    roles: env["OIDC_ROLES_CLAIM"] ?? DEFAULT_CLAIM_MAPPING.roles,
    permissions:
      env["OIDC_PERMISSIONS_CLAIM"] ?? DEFAULT_CLAIM_MAPPING.permissions,
    features: env["OIDC_FEATURES_CLAIM"] ?? DEFAULT_CLAIM_MAPPING.features,
    plan: env["OIDC_PLAN_CLAIM"] ?? DEFAULT_CLAIM_MAPPING.plan,
    orgId: env["OIDC_ORG_ID_CLAIM"] ?? DEFAULT_CLAIM_MAPPING.orgId,
    email: env["OIDC_EMAIL_CLAIM"] ?? DEFAULT_CLAIM_MAPPING.email,
    name: env["OIDC_NAME_CLAIM"] ?? DEFAULT_CLAIM_MAPPING.name,
    picture: env["OIDC_PICTURE_CLAIM"] ?? DEFAULT_CLAIM_MAPPING.picture,
    company: env["OIDC_COMPANY_CLAIM"] ?? DEFAULT_CLAIM_MAPPING.company,
    authorizedParty: parseList(
      env["OIDC_AUTHORIZED_PARTY_CLAIMS"],
      DEFAULT_CLAIM_MAPPING.authorizedParty,
    ),
  };
}

/**
 * OidcConfigManager — Provides OIDC/OAuth2 configuration to sibling middlewares.
 *
 * Register once in your IOServer `addManager` call:
 * ```ts
 * server.addManager({ name: "oidcConfig", manager: OidcConfigManager });
 * ```
 *
 * The middlewares (`OidcHttpMiddleware`, `OidcSocketMiddleware`) read
 * `appHandle.oidcConfig.getConfig()` at startup. If this manager is absent,
 * the middlewares fall back to reading the environment directly.
 *
 * Native auth-service mode (default):
 *   AUTH_SERVICE_URL       — Public base URL of the auth-service instance
 *   AUTH_SERVICE_APP_SLUG  — OAuth2 client_id / application slug
 *   AUTH_SERVICE_AUDIENCE  — Expected `aud` claim, RFC 8707 resource mode
 *
 * Generic OIDC mode (`OIDC_PROVIDER=oidc`):
 *   OIDC_ISSUER, OIDC_JWKS_URI, OIDC_AUDIENCE, OIDC_CLIENT_ID (optional)
 */
export class OidcConfigManager extends BaseManager {
  private _config: OidcConfig | null = null;

  async start(): Promise<void> {
    this._config = buildConfig();
    this.appHandle.log(
      6,
      `[OidcConfigManager] Initialized — provider=${this._config.provider ?? "auth-service"}, issuer=${this._config.issuer ?? this._config.authServiceUrl}, appSlug=${this._config.appSlug || "(none)"}`,
    );
  }

  /**
   * Returns the resolved OIDC configuration.
   * Throws if the manager has not started yet.
   */
  getConfig(): OidcConfig {
    if (!this._config) {
      throw new Error(
        "[OidcConfigManager] getConfig() called before start(). Ensure OidcConfigManager is registered and started.",
      );
    }
    return this._config;
  }
}

/**
 * Build the `OidcConfig` from environment variables.
 * Exported for use by the middleware fallback path when no manager is registered.
 */
export function buildConfig(): OidcConfig {
  const env = process.env;
  const provider = parseProvider(env["OIDC_PROVIDER"]);
  const claims = buildClaimMapping();
  const adminRoles = parseList(
    env["OIDC_ADMIN_ROLES"] ?? env["AUTH_SERVICE_ADMIN_ROLES"],
    ["admin"],
  );
  const clockToleranceSeconds = parsePositiveInteger(
    env["OIDC_CLOCK_TOLERANCE_SECONDS"],
    5,
  );
  const gatewayUrl = env["AUTH_SERVICE_GATEWAY_URL"]?.replace(/\/$/, "");

  if (provider === "oidc") {
    const issuer = env["OIDC_ISSUER"]?.trim().replace(/\/$/, "");
    const jwksUri = env["OIDC_JWKS_URI"]?.trim();
    const audience = env["OIDC_AUDIENCE"]?.trim();

    if (!issuer) {
      throw new Error(
        "[OidcConfigManager] OIDC_ISSUER environment variable is required when OIDC_PROVIDER=oidc.",
      );
    }
    if (!jwksUri) {
      throw new Error(
        "[OidcConfigManager] OIDC_JWKS_URI environment variable is required when OIDC_PROVIDER=oidc.",
      );
    }
    if (!audience) {
      throw new Error(
        "[OidcConfigManager] OIDC_AUDIENCE environment variable is required when OIDC_PROVIDER=oidc.",
      );
    }
    assertHttpUrl(issuer, "OIDC_ISSUER");
    assertHttpUrl(jwksUri, "OIDC_JWKS_URI");

    const algorithms = parseList(env["OIDC_ALGORITHMS"], []);
    const rejected = algorithms.filter(
      (value) => !isAsymmetricAlgorithm(value),
    );
    if (rejected.length > 0) {
      throw new Error(
        `[OidcConfigManager] OIDC_ALGORITHMS only accepts asymmetric JWS algorithms (RS*, PS*, ES*, EdDSA); rejected: ${rejected.join(", ")}.`,
      );
    }
    return {
      provider,
      authServiceUrl: issuer,
      appSlug: env["OIDC_CLIENT_ID"]?.trim() ?? "",
      issuer,
      jwksUri,
      audience,
      ...(algorithms.length > 0 ? { algorithms } : {}),
      clockToleranceSeconds,
      allowMachineTokens: parseBoolean(env["OIDC_ALLOW_MACHINE_TOKENS"], true),
      adminRoles,
      ...(gatewayUrl ? { gatewayUrl } : {}),
      claims,
    };
  }

  const authServiceUrl = (env["AUTH_SERVICE_URL"] ?? "").trim();
  const appSlug = (env["AUTH_SERVICE_APP_SLUG"] ?? "").trim();

  if (!authServiceUrl) {
    throw new Error(
      "[OidcConfigManager] AUTH_SERVICE_URL environment variable is required.",
    );
  }
  if (!appSlug) {
    throw new Error(
      "[OidcConfigManager] AUTH_SERVICE_APP_SLUG environment variable is required.",
    );
  }

  const baseUrl = assertHttpUrl(
    authServiceUrl.replace(/\/$/, ""),
    "AUTH_SERVICE_URL",
  );
  const explicitJwksUri = env["AUTH_SERVICE_JWKS_URI"]?.trim();
  const explicitIssuer = env["AUTH_SERVICE_ISSUER"]?.trim();
  if (explicitJwksUri) assertHttpUrl(explicitJwksUri, "AUTH_SERVICE_JWKS_URI");
  if (explicitIssuer) assertHttpUrl(explicitIssuer, "AUTH_SERVICE_ISSUER");
  return {
    provider,
    authServiceUrl: baseUrl,
    appSlug,
    ...(explicitJwksUri ? { jwksUri: explicitJwksUri } : {}),
    ...(explicitIssuer ? { issuer: explicitIssuer } : {}),
    ...(env["AUTH_SERVICE_AUDIENCE"]?.trim()
      ? { audience: env["AUTH_SERVICE_AUDIENCE"].trim() }
      : {}),
    clockToleranceSeconds,
    allowMachineTokens: parseBoolean(
      env["AUTH_SERVICE_ALLOW_MACHINE_TOKENS"],
      false,
    ),
    adminRoles,
    ...(gatewayUrl ? { gatewayUrl } : {}),
    claims,
  };
}
