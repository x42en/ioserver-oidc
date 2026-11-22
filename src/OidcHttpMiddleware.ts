import { BaseMiddleware } from "ioserver";
import type { AppHandle } from "ioserver";
import { verifyOidcToken } from "./jwks.js";
import { buildConfig } from "./OidcConfigManager.js";
import { applyAuthContext } from "./context.js";
import { OidcTokenError } from "./errors.js";
import type { OidcConfig, OidcUserContext } from "./types.js";

interface HttpRequestLike extends Record<string, unknown> {
  headers: {
    authorization?: string;
  };
}

interface HttpReplyLike {
  code(statusCode: number): HttpReplyLike;
  header?(name: string, value: string): HttpReplyLike;
  send(payload: unknown): void;
}

interface LocalUser {
  id: string;
  role: string;
  isDisabled: boolean;
}

/**
 * OidcHttpMiddleware — Verifies OIDC/OAuth2 JWT access tokens on HTTP routes.
 *
 * Native auth-service mode is the default. Set `OIDC_PROVIDER=oidc` for any
 * other standards-compliant issuer, with configurable claim names.
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
 * On success, injects the user context onto the Fastify request (`sub`,
 * `userId`, `userRole`, `roles`, `permissions`, `features`, `plan`, `sid`,
 * `clientId`, `scopes`, `isMachine`, `auth`, `authToken`, and `org_id` when
 * present).
 *
 * The middleware calls `appHandle.users.findOrCreate(sub, { email, name })`
 * to auto-provision the local user record on first access.
 * Disabled accounts are rejected with 403.
 */
export class OidcHttpMiddleware extends BaseMiddleware {
  private _config: OidcConfig | null = null;

  handle(appHandle: AppHandle) {
    return async (request: HttpRequestLike, reply: HttpReplyLike) => {
      reply.header?.("vary", "authorization");
      reply.header?.("cache-control", "private, no-store");

      // ── 1. Resolve config (lazy, cached after first call) ─────────────
      if (!this._config) {
        try {
          this._config = this._resolveConfig(appHandle);
        } catch (err) {
          appHandle.log(
            3,
            `[OidcHttpMiddleware] OIDC configuration unavailable: ${String(err)}`,
          );
          reply.code(503).send({
            statusCode: 503,
            error: "Service Unavailable",
            code: "ERR_OIDC_CONFIG",
            message: "Authentication is temporarily unavailable.",
          });
          return;
        }
      }

      // ── 2. Extract Bearer token ────────────────────────────────────────
      const authHeader = request.headers.authorization;
      const bearerMatch =
        typeof authHeader === "string"
          ? /^Bearer\s+(.+)$/i.exec(authHeader.trim())
          : null;
      if (!bearerMatch?.[1]) {
        reply.header?.("www-authenticate", 'Bearer realm="api"');
        reply.code(401).send({
          statusCode: 401,
          error: "Unauthorized",
          code: "ERR_AUTH_TOKEN_REQUIRED",
          message: "Bearer token required.",
        });
        return;
      }

      const token = bearerMatch[1].trim();

      // ── 3. Verify JWT ──────────────────────────────────────────────────
      let oidcCtx: OidcUserContext;
      try {
        oidcCtx = await verifyOidcToken(token, this._config);
      } catch (err) {
        appHandle.log(
          3,
          `[OidcHttpMiddleware] JWT verification failed: ${String(err)}`,
        );
        const code =
          err instanceof OidcTokenError ? err.code : "ERR_AUTH_TOKEN_INVALID";
        const statusCode = code === "ERR_MACHINE_TOKEN_FORBIDDEN" ? 403 : 401;
        if (statusCode === 401) {
          reply.header?.("www-authenticate", 'Bearer realm="api"');
        }
        reply.code(statusCode).send({
          statusCode,
          error: statusCode === 403 ? "Forbidden" : "Unauthorized",
          code,
          message:
            code === "ERR_MACHINE_TOKEN_FORBIDDEN"
              ? "Machine tokens are not accepted on user routes."
              : "Invalid or expired token.",
        });
        return;
      }

      // ── 4. Auto-provision local user record ────────────────────────────
      let user: LocalUser | null = null;

      if (
        !oidcCtx.isMachine &&
        typeof appHandle["users"]?.findOrCreate === "function"
      ) {
        try {
          user = (await appHandle["users"].findOrCreate(oidcCtx.sub, {
            email: oidcCtx.email,
            name: oidcCtx.name,
          })) as LocalUser;
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
      applyAuthContext(request, oidcCtx, token, user);
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
