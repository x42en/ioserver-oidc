import { BaseMiddleware } from "ioserver";
import type { AppHandle } from "ioserver";
import { verifyOidcToken } from "./jwks.js";
import { buildConfig } from "./OidcConfigManager.js";
import type { OidcConfig } from "./types.js";

/**
 * OidcSocketMiddleware — Verifies OIDC/OAuth2 JWT access tokens on Socket.IO namespaces.
 *
 * Usage:
 * ```ts
 * server.addService({
 *   name: "tenants",
 *   service: TenantService,
 *   middlewares: [OidcSocketMiddleware],
 * });
 * ```
 *
 * The token is read from:
 *   1. `socket.handshake.auth.token`              (preferred — set by the Vue client)
 *   2. `socket.handshake.headers.authorization`   (Bearer fallback)
 *
 * On success, injects the following onto the socket:
 *   - `socket.sub`         — OIDC subject
 *   - `socket.userId`      — Local DB user ID
 *   - `socket.userRole`    — Primary role ("admin" | "user")
 *   - `socket.roles`       — Full roles array
 *   - `socket.permissions` — Permission strings array
 *   - `socket.features`    — Feature flags / limits object
 *
 * If `appHandle.session.registerSocket(...)` is available, it is called
 * so the connection appears in the admin sessions panel.
 *
 * On failure, calls `next(new Error("ERR_*"))` which rejects the connection.
 */
export class OidcSocketMiddleware extends BaseMiddleware {
  private _config: OidcConfig | null = null;

  handle(appHandle: AppHandle) {
    return async (socket: any, next: (err?: Error) => void) => {
      // ── 1. Resolve config (lazy, cached) ──────────────────────────────
      if (!this._config) {
        this._config = this._resolveConfig(appHandle);
      }

      // ── 2. Extract token ───────────────────────────────────────────────
      let token: string | undefined = socket.handshake?.auth?.token as
        | string
        | undefined;

      if (!token) {
        const authHeader = socket.handshake?.headers?.authorization as
          | string
          | undefined;
        if (authHeader?.startsWith("Bearer ")) {
          token = authHeader.slice(7);
        }
      }

      if (!token) {
        return next(new Error("ERR_AUTH_TOKEN_REQUIRED"));
      }

      // ── 3. Verify JWT ──────────────────────────────────────────────────
      let oidcCtx;
      try {
        oidcCtx = await verifyOidcToken(token, this._config);
      } catch (err) {
        appHandle.log(
          3,
          `[OidcSocketMiddleware] JWT verification failed: ${String(err)}`,
        );
        return next(new Error("ERR_AUTH_TOKEN_INVALID"));
      }

      // ── 4. Auto-provision local user record ────────────────────────────
      let user: {
        id: string;
        role: string;
        isDisabled: boolean;
        email?: string | null;
        name?: string | null;
      } | null = null;

      if (typeof appHandle["users"]?.findOrCreate === "function") {
        try {
          user = await appHandle["users"].findOrCreate(oidcCtx.sub, {
            email: oidcCtx.email,
            name: oidcCtx.name,
          });
        } catch (err) {
          appHandle.log(
            3,
            `[OidcSocketMiddleware] findOrCreate failed: ${String(err)}`,
          );
          return next(new Error("ERR_USER_PROVISION_FAILED"));
        }

        if (user?.isDisabled) {
          return next(new Error("ERR_ACCOUNT_DISABLED"));
        }
      }

      // ── 5. Inject auth context ────────────────────────────────────────
      socket.sub = oidcCtx.sub;
      socket.userId = user?.id ?? oidcCtx.sub;
      socket.userRole = user?.role ?? oidcCtx.userRole;
      socket.roles = oidcCtx.roles;
      socket.permissions = oidcCtx.permissions;
      socket.features = oidcCtx.features;

      // ── 6. Register with session manager (if available) ──────────────
      if (typeof appHandle["session"]?.registerSocket === "function") {
        const namespace = (socket.nsp?.name ?? "").replace(/^\//, "");
        appHandle["session"].registerSocket(
          socket,
          namespace,
          user?.email ?? oidcCtx.email ?? null,
          user?.name ?? oidcCtx.name ?? null,
        );
        socket.on("disconnect", () => {
          appHandle["session"]?.unregisterSocket?.(socket.id);
        });
      }

      next();
    };
  }

  private _resolveConfig(appHandle: AppHandle): OidcConfig {
    if (typeof appHandle["oidcConfig"]?.getConfig === "function") {
      return appHandle["oidcConfig"].getConfig() as OidcConfig;
    }
    return buildConfig();
  }
}
