/**
 * ioserver-oidc — OIDC/OAuth2 middleware set for IOServer.
 *
 * Native auth-service mode is the default: tokens issued by CIRCLE
 * auth-service are verified against its JWKS, with RBAC, plan features,
 * organizations and LiteLLM/gateway support. Set `OIDC_PROVIDER=oidc` to use
 * any other standards-compliant OAuth 2.x / OIDC issuer with configurable
 * claim names.
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
 * Native environment:
 *   AUTH_SERVICE_URL       — Public base URL of the auth-service instance
 *   AUTH_SERVICE_APP_SLUG  — OAuth2 client_id / application slug
 *   AUTH_SERVICE_AUDIENCE  — Expected `aud` claim (RFC 8707 resource URL)
 *   AUTH_SERVICE_GATEWAY_URL — Optional LiteLLM gateway URL
 */

export { OidcConfigManager, buildConfig } from "./OidcConfigManager.js";
export { OidcMachineManager } from "./OidcMachineManager.js";
export { OidcHttpMiddleware } from "./OidcHttpMiddleware.js";
export { OidcSocketMiddleware } from "./OidcSocketMiddleware.js";
export { OidcSocketAdminMiddleware } from "./OidcSocketAdminMiddleware.js";
export { verifyOidcToken } from "./jwks.js";
export { DEFAULT_CLAIM_MAPPING } from "./claims.js";
export { applyAuthContext } from "./context.js";
export { OidcResourceError, OidcTokenError } from "./errors.js";
export type { OidcErrorCode } from "./errors.js";
export {
  invalidateResource,
  listAccessibleResources,
  recordResourceUsage,
  requireResourceAccess,
  validateResource,
} from "./resources.js";
export type { AllowedResource, ResourceAccessOptions } from "./resources.js";
export {
  buildProtectedResourceMetadata,
  registerProtectedResourceMetadata,
} from "./metadata.js";
export type { RegisterProtectedResourceMetadataOptions } from "./metadata.js";
export { registerResourceWebhook } from "./webhook.js";
export type { RegisterResourceWebhookOptions } from "./webhook.js";
export { createOrganizationsClient } from "./organizations.js";
export type { AuthServiceOrganizationsOptions } from "./organizations.js";

// ── auth-service / LiteLLM helpers ─────────────────────────────────────────
export {
  AuthServiceWalletClient,
  MICRO_PER_EUR,
  createWalletClient,
} from "./wallet.js";
export type {
  AuthServiceWalletOptions,
  ListTransactionsOptions,
  TopupOptions,
  WalletAccount,
  WalletSessionUsage,
  WalletSessionUsageOptions,
  WalletStats,
  WalletStatsOptions,
  WalletTransaction,
  WalletTransactionPage,
  WalletTransactionType,
} from "./wallet.js";
export {
  AuthAiError,
  GatewayClient,
  createGatewayClient,
  createRequestGatewayClient,
  isInsufficientCredit,
  isInsufficientCreditStatus,
  toGatewayError,
} from "./gateway.js";
export type {
  AuthServiceGatewayOptions,
  RequestGatewayOptions,
  GatewayAgent,
  GatewayClientOptions,
  GatewayMcpServer,
  GatewayModel,
  GatewayTokens,
} from "./gateway.js";
export { registerBackchannelLogout } from "./backchannel.js";
export type { RegisterBackchannelLogoutOptions } from "./backchannel.js";

// ── Entitlement helpers (shared wire contract with auth-ai) ────────────────
export {
  formatEuros,
  getFeature,
  hasFeature,
  hasPermission,
  hasRole,
  isAuthAiErrorCode,
  invitationTokenSchema,
  ORGANIZATION_SELF_SCOPE,
  organizationSchema,
  OrganizationsClient,
  RESOURCE_SELF_SCOPE,
  WALLET_SELF_SCOPE,
} from "@circle-rd/auth-ai";
export type {
  CreateOrganizationInput,
  FeatureValue,
  IdTokenClaims,
  InvitationToken,
  ListOrganizationsOptions,
  Organization,
  PermissionAction,
  SessionUser,
} from "@circle-rd/auth-ai";

// ── auth-service server primitives (machine API, resources, webhooks) ───────
export {
  MachineApi,
  ResourcesApi,
  bearerChallenge,
  createBearerVerifier,
  createMachineApi,
  extractBearerToken,
  protectedResourceMetadata,
  protectedResourceMetadataPath,
  requireScopes,
  resourceEventSchema,
  resourceWebhookEventTypeSchema,
  verifyResourceEvent,
} from "@circle-rd/auth-ai/server";
export type {
  AccessibleResource,
  AuthorizeDecision,
  AuthorizeRequest,
  BearerChallengeOptions,
  BearerVerifier,
  BearerVerifierOptions,
  ListAccessibleOptions,
  ProtectedResourceMetadata,
  ProtectedResourceMetadataOptions,
  ResourceEvent,
  ResourceEventHeaders,
  ResourceState,
  ResourceWebhookEventType,
  UsageReceipt,
  UsageRecord,
  ValidationOutcome,
  VerifiedAccessToken,
  VerifyResourceEventOptions,
} from "@circle-rd/auth-ai/server";

export type {
  OidcClaimMapping,
  OidcConfig,
  OidcFeatures,
  OidcProvider,
  OidcUserContext,
} from "./types.js";
