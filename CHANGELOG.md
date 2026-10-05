# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/x42en/ioserver-oidc/compare/v0.2.3...HEAD
[0.2.3]: https://github.com/x42en/ioserver-oidc/compare/v0.2.2...v0.2.3
[0.2.0]: https://github.com/x42en/ioserver-oidc/compare/v0.1.4...v0.2.0
[0.1.4]: https://github.com/x42en/ioserver-oidc/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/x42en/ioserver-oidc/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/x42en/ioserver-oidc/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/x42en/ioserver-oidc/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/x42en/ioserver-oidc/releases/tag/v0.1.0
