# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] — 2026-11-23

### Added

- **auth-ai 0.5.0** — upgraded to the SDK release that adds self-service teams.
- **`createOrganizationsClient()`** — returns the signed-in user's auth-ai
  `OrganizationsClient` from the already verified access token. Supports
  listing teams/companies, creating teams, joining/leaving and invitation
  tokens.
- **Team exports** — `ORGANIZATION_SELF_SCOPE`, `OrganizationsClient`,
  `organizationSchema`, `invitationTokenSchema` and the `Organization`,
  `InvitationToken`, `CreateOrganizationInput` and `ListOrganizationsOptions`
  types.
- Documentation and migration guide for teams and the auth-ai
  `teamManagement: true` sign-in option.

### Security

- The organizations helper forwards only an already verified token, requires an
  HTTPS issuer (loopback or explicit insecure opt-in for development) and
  never mints, logs or stores tokens. auth-service remains the authorization
  decision point; `ORG_*` refusals are surfaced through auth-ai errors.

## [0.4.0] — 2026-11-22

### Added

- **auth-ai 0.4.0** — upgraded the SDK dependency and aligned the public API
  with the published tarball (`ResourcesApi`, resource webhooks,
  `listAggregates`/`getAggregate`).
- **`OidcMachineManager`** — exposes the confidential auth-service machine API
  through `appHandle.oidcMachine` (`resources`, `billing`, `consumption`). The
  client secret comes from `AUTH_SERVICE_CLIENT_SECRET` and is never stored in
  `OidcConfig` or logged.
- **Resource helpers** — `requireResourceAccess()` (fail-closed), plus
  `listAccessibleResources`, `validateResource`, `invalidateResource` and
  `recordResourceUsage`.
- **Resource webhooks** — `registerResourceWebhook()` verifies
  `X-Auth-Service-Signature` over the raw body with an encapsulated JSON parser,
  deduplicates on `eventId` and keeps every other JSON route unchanged.
- **Protected-resource metadata** — `buildProtectedResourceMetadata()` and
  `registerProtectedResourceMetadata()` serve RFC 9728 metadata;
  `OIDC_RESOURCE_METADATA_URL` and `OIDC_SCOPES_SUPPORTED` add
  `resource_metadata`/`scope` to the Bearer challenge.
- **Context** — `OidcUserContext.audiences` exposes the verified `aud` values.
- **Re-exports** — auth-ai server primitives (`MachineApi`, `ResourcesApi`,
  `createMachineApi`, `verifyResourceEvent`, `createBearerVerifier`,
  `requireScopes`, `bearerChallenge`, protected-resource helpers and their
  types), `RESOURCE_SELF_SCOPE` and `isAuthAiErrorCode`.
- **New error codes** — `ERR_RESOURCE_FORBIDDEN` and `ERR_RESOURCE_CONFIG`.

### Fixed

- Path-based issuers keep their trailing slash; derived JWKS/redirect URLs use
  a safe join instead of stripping the issuer.
- Back-channel logout now documents and tests auth-ai's `200` response and
  exposes `allowMissingTyp` for known non-conforming providers.
- Bearer parsing remains case-insensitive and the access-token `aud` is
  available to resource decisions.
- `OidcConfigManager` now validates environment variables in its constructor
  and fails startup on invalid configuration.

### Security

- Resource authorization treats deny, timeout, malformed answers and SDK
  failures as a refusal; only an explicit `allow` returns.
- Webhook verification uses the raw body and constant-time HMAC validation from
  auth-ai; stale timestamps and replayed `eventId` values are rejected.
- Machine API and webhook secrets are read from the environment, are never
  serialized into configuration, and are never written to logs.

## [0.3.2] — 2026-11-22

### Security

- **Transport security** — `AUTH_SERVICE_URL`, issuer/JWKS URLs, the LiteLLM
  gateway URL, wallet clients and back-channel logout now require HTTPS for
  non-loopback hosts. Plain HTTP remains available for loopback development or
  with the explicit `OIDC_ALLOW_INSECURE_HTTP` / `allowInsecureHttp` opt-in.
- **Generic machine tokens** — `client_credentials` detection (`sub === azp`)
  now applies to the generic OIDC provider. `OIDC_ALLOW_MACHINE_TOKENS` defaults
  to `false` for both providers, and allowed machine tokens are never
  auto-provisioned as local users.
- **Token type checks** — `exp`, `iss`, `aud` and `sub` are required. Tokens
  carrying ID-token markers (`nonce`, `at_hash`, `c_hash`), a non-`access`
  `token_use`, or explicit `id+jwt`/`logout+jwt` types are rejected. A
  dedicated access-token `typ` can be required via `tokenType` /
  `OIDC_TOKEN_TYP` / `AUTH_SERVICE_TOKEN_TYP`.
- **Socket.IO failure containment** — configuration and session-registration
  failures now call `next(...)` instead of leaving the handshake pending.
- **Admin fail-closed** — a registered but unavailable config manager denies
  admin access instead of falling back to environment roles. An explicitly
  empty admin-role list now denies all admin access.
- **Config fail-fast** — `OidcConfigManager` validates its environment in the
  constructor, so invalid configuration fails server startup.
- `DEFAULT_CLAIM_MAPPING` is frozen to prevent runtime mutation.
- Authenticated HTTP responses carry `Vary: Authorization` and
  `Cache-Control: private, no-store`; 401 responses carry a Bearer challenge.
- `OIDC_CLIENT_ID` is required in generic mode, so resource-audience tokens are
  always bound to an authorized party.

### Added

- `ERR_OIDC_CONFIG` (HTTP 503 / Socket rejection) for unavailable OIDC
  configuration.
- `allowInsecureHttp` options on wallet/gateway/back-channel helpers and
  `RequestGatewayOptions`.

### Fixed

- Documentation examples now use `buildConfig()` / `appHandle.oidcConfig`
  instead of the removed `server.getManager()` API.
- Bearer scheme parsing is case-insensitive and tolerates multiple spaces.

### Changed

- `OidcConfigManager.getConfig()` returns the validated configuration
  immediately; it no longer throws before `start()`.
- `OIDC_ADMIN_ROLES` / `AUTH_SERVICE_ADMIN_ROLES` no longer reset an explicitly
  empty value to `["admin"]`.

## [0.3.1] — 2026-11-05

### Changed

- **`ioserver` baseline raised to 2.3.0** — the peer-dependency floor and the
  development dependency move from `>=2.2.1` / `^2.2.1` to `>=2.3.0` /
  `^2.3.0`, and the README, installation guide, contributor guide and agent
  contract now state 2.3.0. No code change is required: the middlewares,
  verifier and helpers only use `BaseManager`, `BaseMiddleware`, `AppHandle`
  and the Fastify instance, whose contracts are unchanged between 2.2.1 and
  2.3.0.
- The LiteLLM gateway, wallet and entitlement helpers continue to come from
  `@circle-rd/auth-ai`; `ioserver` itself exposes no LiteLLM feature in either
  the 2.2.x or the 2.3.x line.
- `pnpm-workspace.yaml` records the 2.3.0 release-age exception so a clean-room
  `pnpm install --frozen-lockfile` keeps working until the release ages past
  the policy cutoff.

## [0.3.0] — 2026-11-04

### Added

- **Native auth-service provider (default)** — `OIDC_PROVIDER=auth-service`
  decodes roles, permissions, plan features, organizations, scopes, `sid` and
  `clientId`, and supports the auth-service `client_credentials` refusal.
- **Generic OIDC provider** — `OIDC_PROVIDER=oidc` verifies any JWKS issuer with
  configurable claim names (`OIDC_*_CLAIM`) and authorized-party claims.
- **LiteLLM gateway helpers** — `createGatewayClient()` and
  `createRequestGatewayClient()` build an auth-ai `GatewayClient` from a user
  token; gateway errors are mapped to `GW_*` codes.
- **Wallet client** — `createWalletClient()` reads the user's auth-service
  wallet, stats, session usage, transactions and top-up options with `bigint`
  micro-euro amounts.
- **Back-channel logout** — `registerBackchannelLogout()` mounts the OIDC
  Back-Channel Logout endpoint on `server.getApp()`.
- **Entitlement helpers** — `hasRole`, `hasPermission`, `hasFeature`,
  `getFeature`, `formatEuros` and `WALLET_SELF_SCOPE` are re-exported from
  `@circle-rd/auth-ai`.
- **Context fields** — `plan`, `sid`, `clientId`, `scopes`, `isMachine`, `auth`
  and `authToken` are injected on HTTP requests and sockets.
- **Configurable admin roles** — `OIDC_ADMIN_ROLES` /
  `AUTH_SERVICE_ADMIN_ROLES` and `OidcConfig.adminRoles`.
- New documentation pages for providers, LiteLLM/wallet, back-channel logout
  and the 0.3 migration.
- Documentation site dependencies updated to Docus 5.15, Nuxt 4.6.4 and
  better-sqlite3 12.11.1, with npm overrides for `zod`, `minimatch`, `glob` and
  `esbuild`. Its Docker defaults now use the origin-only `NUXT_SITE_URL`
  required by Docus 5.15, and its generated `package-lock.json` is ignored and
  no longer committed.

### Changed

- Defaults and architecture align with `auth-service` and `@circle-rd/auth-ai`:
  Node 22+, `ioserver` 2.2.1+, TypeScript 6, Vitest 5, ESLint 10 and Prettier.
- `OidcConfigManager` now validates the provider and all required variables at
  startup, with explicit native and generic error messages.
- `verifyOidcToken` now accepts a clock tolerance (default 5 seconds) and maps
  optional claims without emitting null fields.

### Security

- Native `client_credentials` tokens (`sub === azp`) are refused by default with
  `ERR_MACHINE_TOKEN_FORBIDDEN`; opt in with
  `AUTH_SERVICE_ALLOW_MACHINE_TOKENS=true`.
- The asymmetric algorithm allow-list is enforced for both environment and
  programmatic configuration: `OIDC_ALGORITHMS` rejects `HS*` and `none`, and
  a manual `algorithms` list is filtered before verification.
- The `sub` claim must be a non-empty string; token payloads are no longer
  cast wholesale.
- Access tokens are bounded to 16 KiB before JWKS verification.
- The generic provider can bind `azp` / custom authorized-party claims to
  `OIDC_CLIENT_ID`, and resource-audience mode requires the party claim when a
  client id is configured.
- Back-channel logout validates signature, `typ`, audience, event, lifetime and
  replay before invoking the callback.
- Wallet and gateway errors never include the access token.
- Cleared all high and moderate advisories with `pnpm-workspace.yaml`
  overrides: `engine.io`, `source-map-js`, `fast-uri`, `glob`, `minimatch` and
  `fastify`. `pnpm audit` now reports no known vulnerabilities.

## [0.2.3] — 2026-10-05

### Security

- **All 17 open Dependabot advisories cleared** (11 high, 6 medium) — dependency
  floors raised to the first patched versions: `ioserver` 2.2.1 (pulls
  `fastify` 5.12.5, `@fastify/static` 10.1.3 and `content-disposition` 2.0.1),
  `vitest` 4.1.11 and `@vitest/coverage-v8` 4.1.11 (GHSA-82fw-gwwq-j7x9), and
  `vite` 8.3.2 (pulls `postcss` 8.5.28, clearing GHSA-r28c-9q8g-f849 and
  GHSA-fxqj-rqcc-2cmp).
- **Four `pnpm-workspace.yaml` overrides** for advisories no declared floor can
  reach, each held by a third-party parent's own range: `fast-uri` `^3.1.8`
  (GHSA-4c8g-83qw-93j6, GHSA-v2hh-gcrm-f6hx, GHSA-7p8r-x3mc-p8w7,
  GHSA-fph4-wmhf-6fwf, GHSA-f65p-4m7j-42xc, GHSA-jqff-g426-hqxp),
  `find-my-way` `^9.7.0` (GHSA-c96f-x56v-gq3h), `socket.io-parser` `^4.2.7`
  (GHSA-2m8v-j782-fhvr) and `brace-expansion` `^5.0.12`
  (GHSA-3jxr-9vmj-r5cp). They become redundant on the next major dependency
  refresh and should be removed then.

### Changed

- CI toolchain: pnpm 12.9.1 pinned through `packageManager`, Node floor
  harmonised at `>=22.0.0`, GitHub Actions refreshed, and the lint gate in
  `build.yml` made blocking.

## [0.2.0] — 2026-06-02

### Security

- **Authorized-party (`azp`) binding** — `verifyOidcToken` now validates the
  `azp` (or `client_id` fallback) claim against `appSlug`. When the token is
  issued in resource-audience mode (`config.audience` set and different from
  `appSlug`, RFC 8707), the authorized-party claim is **mandatory**. This
  defends against cross-application token reuse on a shared auth-service pool
  where `roles` / `permissions` are scoped per application.
- **Algorithm allow-list** — Signature verification is now restricted to an
  asymmetric allow-list (`RS256/384/512`, `PS256/384/512`, `ES256/384/512`,
  `EdDSA`). Symmetric algorithms (`HS*`) and `none` are rejected to prevent
  algorithm-confusion attacks. Override via the new `OidcConfig.algorithms`.
- **Strict claim typing** — `roles` and `permissions` are filtered to string
  elements only, so malformed claims cannot leak into downstream checks.

### Added

- `OidcConfig.algorithms` — optional JWS algorithm allow-list override.

### Changed

- Dependency updates: `jose` 6.2.3, TypeScript 6.0, `@types/node` 25, Vitest 4,
  ESLint 10.

## [0.1.4] — 2026-04-13

### Added

- Example webapp: handle the `company` profile field end-to-end.

### Fixed

- Test suite now validates the standard and custom JWT claims explicitly.

## [0.1.3] — 2026-04-13

### Added

- `OidcConfig.audience` (and `AUTH_SERVICE_AUDIENCE` env var) — support for the
  `@better-auth/oauth-provider` v1.5+ `resource` audience (RFC 8707), so JWTs
  whose `aud` is a resource URL rather than the `client_id` are accepted.

## [0.1.2] — 2026-04-12

### Added

- CI: trusted-publisher npm publishing and automated test runs.

### Fixed

- CI: corrected the publish workflow and the test/lint include paths.

## [0.1.1] — 2026-04-12

### Added

- CI: GitHub repository deployment workflow.

### Fixed

- Documentation badges.

## [0.1.0] — 2026-04-05

### Added

- `OidcConfigManager` — IOServer manager that reads `AUTH_SERVICE_URL` and
  `AUTH_SERVICE_APP_SLUG` from environment variables and exposes them to sibling
  middlewares via `appHandle.oidcConfig.getConfig()`.
- `OidcHttpMiddleware` — Fastify HTTP middleware that verifies OIDC/OAuth2 JWT
  access tokens via JWKS, auto-provisions the local user record, and injects
  `sub`, `userId`, `userRole`, `roles`, `permissions`, and `features` onto the
  request object.
- `OidcSocketMiddleware` — Socket.IO middleware equivalent of
  `OidcHttpMiddleware` for WebSocket connections.
- `OidcSocketAdminMiddleware` — Role guard that rejects Socket.IO connections
  lacking the `admin` role. Must be chained after `OidcSocketMiddleware`.
- `verifyOidcToken` — Low-level helper that verifies a raw JWT string against
  the remote JWKS and returns an `OidcUserContext`.
- Full TypeScript declarations and ESM-only distribution.
- GitHub Actions workflow for automated npm publishing on version tags.

[Unreleased]: https://github.com/x42en/ioserver-oidc/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/x42en/ioserver-oidc/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/x42en/ioserver-oidc/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/x42en/ioserver-oidc/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/x42en/ioserver-oidc/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/x42en/ioserver-oidc/compare/v0.2.3...v0.3.0
[0.2.3]: https://github.com/x42en/ioserver-oidc/compare/v0.2.2...v0.2.3
[0.2.0]: https://github.com/x42en/ioserver-oidc/compare/v0.1.4...v0.2.0
[0.1.4]: https://github.com/x42en/ioserver-oidc/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/x42en/ioserver-oidc/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/x42en/ioserver-oidc/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/x42en/ioserver-oidc/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/x42en/ioserver-oidc/releases/tag/v0.1.0
