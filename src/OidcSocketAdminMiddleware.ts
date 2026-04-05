import { BaseMiddleware } from "ioserver";
import type { AppHandle } from "ioserver";

/**
 * OidcSocketAdminMiddleware — Role guard for admin-only Socket.IO namespaces.
 *
 * Must be chained **after** `OidcSocketMiddleware`, which injects
 * `socket.userRole` and `socket.roles`.
 *
 * Rejects the Socket.IO connection with `ERR_FORBIDDEN` if the authenticated
 * user does not hold the "admin" role.
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
  handle(_appHandle: AppHandle) {
    return (socket: any, next: (err?: Error) => void) => {
      const roles: string[] = Array.isArray(socket.roles)
        ? socket.roles
        : typeof socket.userRole === "string"
          ? [socket.userRole]
          : [];

      if (!roles.includes("admin")) {
        return next(new Error("ERR_FORBIDDEN"));
      }

      next();
    };
  }
}
