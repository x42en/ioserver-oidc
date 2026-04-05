/**
 * ioserver-oidc — OIDC/OAuth2 middleware set for IOServer.
 *
 * Provides drop-in middleware classes that protect Fastify HTTP routes and
 * Socket.IO namespaces by verifying JWT access tokens issued by auth-service
 * (BetterAuth + OAuth2 provider) via JWKS.
 *
 * Quick start:
 * ```ts
 * import {
 *   OidcConfigManager,
 *   OidcHttpMiddleware,
 *   OidcSocketMiddleware,
 *   OidcSocketAdminMiddleware,
 * } from "ioserver-oidc";
 *
 * server.addManager({ name: "oidcConfig", manager: OidcConfigManager });
 *
 * server.addController({
 *   name: "setup",
 *   controller: SetupController,
 *   middlewares: [OidcHttpMiddleware],
 *   prefix: "/setup",
 * });
 *
 * server.addService({
 *   name: "tenants",
 *   service: TenantService,
 *   middlewares: [OidcSocketMiddleware],
 * });
 *
 * server.addService({
 *   name: "users",
 *   service: UserService,
 *   middlewares: [OidcSocketMiddleware, OidcSocketAdminMiddleware],
 * });
 * ```
 *
 * Required environment variables:
 *   AUTH_SERVICE_URL       — Public base URL of the auth-service instance
 *   AUTH_SERVICE_APP_SLUG  — OAuth2 client_id / application slug
 */

export { OidcConfigManager } from "./OidcConfigManager.js";
export { OidcHttpMiddleware } from "./OidcHttpMiddleware.js";
export { OidcSocketMiddleware } from "./OidcSocketMiddleware.js";
export { OidcSocketAdminMiddleware } from "./OidcSocketAdminMiddleware.js";
export { verifyOidcToken } from "./jwks.js";

export type { OidcConfig, OidcUserContext, OidcFeatures } from "./types.js";
