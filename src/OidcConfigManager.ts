import { BaseManager } from "ioserver";
import type { OidcConfig } from "./types.js";

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
 * the middlewares fall back to reading `AUTH_SERVICE_URL` and
 * `AUTH_SERVICE_APP_SLUG` directly from `process.env`.
 *
 * Required environment variables:
 *   AUTH_SERVICE_URL       — Public base URL of the auth-service instance
 *   AUTH_SERVICE_APP_SLUG  — OAuth2 client_id / application slug
 *
 * Optional environment variables:
 *   AUTH_SERVICE_JWKS_URI  — Override the JWKS URI (default: <AUTH_SERVICE_URL>/api/auth/jwks)
 *   AUTH_SERVICE_ISSUER    — Override the JWT issuer (default: AUTH_SERVICE_URL)
 */
export class OidcConfigManager extends BaseManager {
  private _config: OidcConfig | null = null;

  async start(): Promise<void> {
    this._config = buildConfig();
    this.appHandle.log(
      6,
      `[OidcConfigManager] Initialized — authServiceUrl=${this._config.authServiceUrl}, appSlug=${this._config.appSlug}`,
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
  const authServiceUrl = process.env["AUTH_SERVICE_URL"] ?? "";
  const appSlug = process.env["AUTH_SERVICE_APP_SLUG"] ?? "";

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

  const base = {
    authServiceUrl: authServiceUrl.replace(/\/$/, ""),
    appSlug,
    ...(process.env["AUTH_SERVICE_JWKS_URI"]
      ? { jwksUri: process.env["AUTH_SERVICE_JWKS_URI"] }
      : {}),
    ...(process.env["AUTH_SERVICE_ISSUER"]
      ? { issuer: process.env["AUTH_SERVICE_ISSUER"] }
      : {}),
    // AUTH_SERVICE_AUDIENCE: the expected `aud` claim in JWT access tokens.
    // Required when using @better-auth/oauth-provider (v1.5+) with the
    // `resource` parameter (RFC 8707). Set to the public API base URL
    // (e.g. "https://api.example.com"). Omit to fall back to appSlug.
    ...(process.env["AUTH_SERVICE_AUDIENCE"]
      ? { audience: process.env["AUTH_SERVICE_AUDIENCE"] }
      : {}),
  };

  return base as OidcConfig;
}
