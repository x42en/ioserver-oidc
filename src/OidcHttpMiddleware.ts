import { BaseMiddleware } from "ioserver";
import type { AppHandle } from "ioserver";
import { verifyOidcToken } from "./jwks.js";
import { buildConfig } from "./OidcConfigManager.js";
import type { OidcConfig } from "./types.js";

/**
 * OidcHttpMiddleware — Verifies OIDC/OAuth2 JWT access tokens on HTTP routes.
 *
 * Usage:
 * ```ts
 * server.addController({
 *   name: "setup",
 *   controller: SetupController,
 *   middlewares: [OidcHttpMiddleware],
 *   prefix: "/setup",
 * });
 * ```
 *
 * On success, injects the following onto the Fastify request:
 *   - `(request as any).sub`         — OIDC subject (stable auth-service user ID)
 *   - `(request as any).userId`      — Local DB user ID (from findOrCreate)
 *   - `(request as any).userRole`    — Primary role ("admin" | "user")
 *   - `(request as any).roles`       — Full roles array
 *   - `(request as any).permissions` — Permission strings array
 *   - `(request as any).features`    — Feature flags / limits object
 *
 * The middleware calls `appHandle.users.findOrCreate(sub, { email, name })`
 * to auto-provision the local user record on first access.
 * Disabled accounts are rejected with 403.
 *
 * Config is resolved from `appHandle.oidcConfig.getConfig()` if available,
 * otherwise falls back to `AUTH_SERVICE_URL` / `AUTH_SERVICE_APP_SLUG` env vars.
 */
export class OidcHttpMiddleware extends BaseMiddleware {
  private _config: OidcConfig | null = null;

  handle(appHandle: AppHandle) {
    return async (request: any, reply: any) => {
      // ── 1. Resolve config (lazy, cached after first call) ─────────────
      if (!this._config) {
        this._config = this._resolveConfig(appHandle);
      }

      // ── 2. Extract Bearer token ────────────────────────────────────────
      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        reply.code(401).send({
          statusCode: 401,
          error: "Unauthorized",
          code: "ERR_AUTH_TOKEN_REQUIRED",
          message: "Bearer token required.",
        });
        return;
      }

      const token = authHeader.slice(7);

      // ── 3. Verify JWT ──────────────────────────────────────────────────
      let oidcCtx;
      try {
        oidcCtx = await verifyOidcToken(token, this._config);
      } catch (err) {
        appHandle.log(
          3,
          `[OidcHttpMiddleware] JWT verification failed: ${String(err)}`,
        );
        reply.code(401).send({
          statusCode: 401,
          error: "Unauthorized",
          code: "ERR_AUTH_TOKEN_INVALID",
          message: "Invalid or expired token.",
        });
        return;
      }

      // ── 4. Auto-provision local user record ────────────────────────────
      let user: { id: string; role: string; isDisabled: boolean } | null = null;

      if (typeof appHandle["users"]?.findOrCreate === "function") {
        try {
          user = await appHandle["users"].findOrCreate(oidcCtx.sub, {
            email: oidcCtx.email,
            name: oidcCtx.name,
          });
        } catch (err) {
          appHandle.log(
            3,
            `[OidcHttpMiddleware] findOrCreate failed: ${String(err)}`,
          );
          reply.code(500).send({
            statusCode: 500,
            error: "Internal Server Error",
            code: "ERR_USER_PROVISION_FAILED",
            message: "Failed to resolve user account.",
          });
          return;
        }

        if (user?.isDisabled) {
          reply.code(403).send({
            statusCode: 403,
            error: "Forbidden",
            code: "ERR_ACCOUNT_DISABLED",
            message:
              "Your account has been disabled. Contact an administrator.",
          });
          return;
        }
      }

      // ── 5. Inject auth context ────────────────────────────────────────
      (request as Record<string, unknown>)["sub"] = oidcCtx.sub;
      (request as Record<string, unknown>)["userId"] = user?.id ?? oidcCtx.sub;
      (request as Record<string, unknown>)["userRole"] =
        user?.role ?? oidcCtx.userRole;
      (request as Record<string, unknown>)["roles"] = oidcCtx.roles;
      (request as Record<string, unknown>)["permissions"] = oidcCtx.permissions;
      (request as Record<string, unknown>)["features"] = oidcCtx.features;
    };
  }

  private _resolveConfig(appHandle: AppHandle): OidcConfig {
    if (typeof appHandle["oidcConfig"]?.getConfig === "function") {
      return appHandle["oidcConfig"].getConfig() as OidcConfig;
    }
    // Fallback: build from env vars directly
    return buildConfig();
  }
}
