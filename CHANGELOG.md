# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/x42en/ioserver-oidc/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/x42en/ioserver-oidc/releases/tag/v0.1.0
