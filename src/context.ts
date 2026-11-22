import type { OidcUserContext } from "./types.js";

interface LocalUser {
  id: string;
  role: string;
  isDisabled: boolean;
}

/**
 * Copy the verified token context onto a Fastify request or a Socket.IO socket.
 * The raw token is kept under `authToken` so callers can forward it or build a
 * gateway client; it must never be logged.
 */
export function applyAuthContext(
  target: object,
  ctx: OidcUserContext,
  token: string,
  user: LocalUser | null,
): void {
  const t = target as Record<string, unknown>;
  const authContext: OidcUserContext = {
    ...ctx,
    userId: user?.id ?? ctx.sub,
    userRole: user?.role ?? ctx.userRole,
  };
  t["sub"] = ctx.sub;
  t["userId"] = authContext.userId;
  t["userRole"] = authContext.userRole;
  t["roles"] = ctx.roles;
  t["permissions"] = ctx.permissions;
  t["features"] = ctx.features;
  t["plan"] = ctx.plan ?? null;
  t["sid"] = ctx.sid ?? null;
  t["clientId"] = ctx.clientId ?? null;
  t["scopes"] = ctx.scopes ?? [];
  t["audiences"] = ctx.audiences ?? [];
  t["isMachine"] = ctx.isMachine === true;
  t["auth"] = authContext;
  t["authToken"] = token;
  if (ctx.org_id !== undefined) t["org_id"] = ctx.org_id;
}
