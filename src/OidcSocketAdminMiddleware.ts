import { BaseMiddleware } from "ioserver";
import type { AppHandle } from "ioserver";
import type { OidcConfig } from "./types.js";

type SocketNext = (err?: Error) => void;

interface AdminSocketLike {
  roles?: unknown;
  userRole?: unknown;
}

function envAdminRoles(): readonly string[] {
  const value =
    process.env["OIDC_ADMIN_ROLES"] ?? process.env["AUTH_SERVICE_ADMIN_ROLES"];
  if (value === undefined) return ["admin"];
  return value
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);
}

/**
 * OidcSocketAdminMiddleware — Role guard for privileged Socket.IO namespaces.
 *
 * Must be chained **after** `OidcSocketMiddleware`, which injects
 * `socket.userRole` and `socket.roles`.
 *
 * Rejects the connection with `ERR_FORBIDDEN` unless the authenticated user
 * holds one of the accepted roles. The default accepted role is `"admin"`;
 * configure it with `OIDC_ADMIN_ROLES` or `AUTH_SERVICE_ADMIN_ROLES`
 * (comma-separated).
 *
 * Usage:
 * ```ts
 * server.addService({
 *   name: "users",
 *   service: UserService,
 *   middlewares: [OidcSocketMiddleware, OidcSocketAdminMiddleware],
 * });
 * ```
 */
export class OidcSocketAdminMiddleware extends BaseMiddleware {
  handle(appHandle: AppHandle) {
    let acceptedRoles: readonly string[] | null = null;

    return (socket: AdminSocketLike, next: SocketNext) => {
      if (!acceptedRoles) {
        acceptedRoles = this._resolveAdminRoles(appHandle);
      }

      const roles: string[] = Array.isArray(socket.roles)
        ? socket.roles.filter(
            (role): role is string => typeof role === "string",
          )
        : typeof socket.userRole === "string"
          ? [socket.userRole]
          : [];

      if (!roles.some((role) => acceptedRoles?.includes(role))) {
        return next(new Error("ERR_FORBIDDEN"));
      }

      next();
    };
  }

  private _resolveAdminRoles(appHandle: AppHandle): readonly string[] {
    const manager = appHandle["oidcConfig"];
    if (typeof manager?.getConfig === "function") {
      try {
        const config = manager.getConfig() as OidcConfig | undefined;
        return config?.adminRoles ?? [];
      } catch {
        // The manager exists but its configuration is unavailable: deny admin
        // access instead of falling back to a possibly broader role list.
        appHandle.log?.(
          3,
          "[OidcSocketAdminMiddleware] OIDC config unavailable; denying admin access.",
        );
        return [];
      }
    }
    return envAdminRoles();
  }
}
