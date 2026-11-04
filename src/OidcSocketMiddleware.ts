import { BaseMiddleware } from "ioserver";
import type { AppHandle } from "ioserver";
import { verifyOidcToken } from "./jwks.js";
import { buildConfig } from "./OidcConfigManager.js";
import { applyAuthContext } from "./context.js";
import { OidcTokenError } from "./errors.js";
import type { OidcConfig, OidcUserContext } from "./types.js";

type SocketNext = (err?: Error) => void;

interface SocketLike {
  handshake?: {
    auth?: {
      token?: unknown;
    };
    headers?: {
      authorization?: unknown;
    };
  };
  nsp?: {
    name?: string;
  };
  id: string;
  on(event: "disconnect", listener: () => void): void;
  sub?: string;
  userId?: string;
  userRole?: string;
  roles?: string[];
  permissions?: unknown;
  features?: unknown;
  org_id?: unknown;
  authToken?: string;
}

interface LocalUser {
  id: string;
  role: string;
  isDisabled: boolean;
  email?: string | null;
  name?: string | null;
}

/**
 * OidcSocketMiddleware — Verifies OIDC/OAuth2 JWT access tokens on Socket.IO namespaces.
 *
 * Native auth-service mode is the default. Set `OIDC_PROVIDER=oidc` for any
 * other standards-compliant issuer.
 *
 * The token is read from:
 *   1. `socket.handshake.auth.token`              (preferred)
 *   2. `socket.handshake.headers.authorization`   (Bearer fallback)
 *
 * On success, injects the same context as `OidcHttpMiddleware` onto the socket,
 * including `auth` and `authToken`.
 *
 * If `appHandle.session.registerSocket(...)` is available, it is called so the
 * connection appears in the admin sessions panel.
 */
export class OidcSocketMiddleware extends BaseMiddleware {
  private _config: OidcConfig | null = null;

  handle(appHandle: AppHandle) {
    return async (socket: SocketLike, next: SocketNext) => {
      // ── 1. Resolve config (lazy, cached) ──────────────────────────────
      if (!this._config) {
        this._config = this._resolveConfig(appHandle);
      }

      // ── 2. Extract token ───────────────────────────────────────────────
      let token: string | undefined =
        typeof socket.handshake?.auth?.token === "string"
          ? socket.handshake.auth.token
          : undefined;

      if (!token) {
        const authHeader = socket.handshake?.headers?.authorization;
        if (
          typeof authHeader === "string" &&
          authHeader.startsWith("Bearer ")
        ) {
          token = authHeader.slice(7);
        }
      }

      if (!token) {
        return next(new Error("ERR_AUTH_TOKEN_REQUIRED"));
      }

      // ── 3. Verify JWT ──────────────────────────────────────────────────
      let oidcCtx: OidcUserContext;
      try {
        oidcCtx = await verifyOidcToken(token, this._config);
      } catch (err) {
        appHandle.log(
          3,
          `[OidcSocketMiddleware] JWT verification failed: ${String(err)}`,
        );
        const code =
          err instanceof OidcTokenError ? err.code : "ERR_AUTH_TOKEN_INVALID";
        return next(new Error(code));
      }

      // ── 4. Auto-provision local user record ────────────────────────────
      let user: LocalUser | null = null;

      if (typeof appHandle["users"]?.findOrCreate === "function") {
        try {
          user = (await appHandle["users"].findOrCreate(oidcCtx.sub, {
            email: oidcCtx.email,
            name: oidcCtx.name,
          })) as LocalUser;
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
      applyAuthContext(socket, oidcCtx, token, user);

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
