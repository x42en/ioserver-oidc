# Contributing to ioserver-oidc

Thank you for your interest in contributing to ioserver-oidc! This document covers the development setup, architecture rules, testing strategy, and release process.

## Table of contents

- [Prerequisites](#prerequisites)
- [Development setup](#development-setup)
- [Architecture rules](#architecture-rules)
  - [Component model](#component-model)
  - [TypeScript requirements](#typescript-requirements)
  - [Naming conventions](#naming-conventions)
- [Test suite](#test-suite)
  - [Running tests](#running-tests)
  - [Coverage targets](#coverage-targets)
  - [Writing tests](#writing-tests)
- [Linting](#linting)
- [Commit conventions](#commit-conventions)
- [Pull requests](#pull-requests)
- [Release process](#release-process)

---

## Prerequisites

- Node.js ≥ 18 (≥ 20 recommended)
- pnpm v9 — `npm install -g pnpm@9`
- TypeScript ≥ 5.0
- An IOServer project as peer dependency (≥ 2.0.0)

## Development setup

```bash
git clone https://github.com/x42en/ioserver-oidc.git
cd ioserver-oidc
pnpm install

# Compile src/ → dist/
pnpm run build

# Watch mode during development
pnpm run dev

# Run all tests
pnpm test
```

---

## Architecture rules

ioserver-oidc provides four plug-and-play IOServer components. Each follows the IOServer five-component model — see [IOServer CONTRIBUTING.md](https://github.com/x42en/IOServer/blob/main/CONTRIBUTING.md) for the full model description.

### Component model

| Component | Role in this library |
|---|---|
| **OidcConfigManager** | Reads `AUTH_SERVICE_*` env vars; exposes an `OidcConfig` to sibling middlewares via `appHandle.oidcConfig.getConfig()` |
| **OidcHttpMiddleware** | Verifies Bearer JWTs on HTTP routes; calls `appHandle.users.findOrCreate`; injects auth context onto `request` |
| **OidcSocketMiddleware** | Same as above for Socket.IO handshake authentication |
| **OidcSocketAdminMiddleware** | Extends `OidcSocketMiddleware` — additionally enforces that the role is `admin` |

Rules:

- **Middlewares must be stateless** between requests/connections. The only allowed persistent state is the JWKS key-set cache (in-memory, keyed by URI).
- **Config is lazy-resolved** on the first request: middlewares call `OidcConfigManager.getConfig()` once and cache the result.
- **No direct `process.env` reads** inside `OidcHttpMiddleware` or `OidcSocketMiddleware` — always go through `buildConfig()` / `OidcConfigManager`.
- **`appHandle.users.findOrCreate`** is called only when the manager is registered. If absent, the middleware falls through without error.

### TypeScript requirements

- `"strict": true` in `tsconfig.json` — no exceptions
- Avoid `any` in public APIs. Use `unknown` + type-guards or define proper interfaces in `src/types.ts`
- All exported functions and class methods must have explicit return types
- The `OidcConfig` interface is the single source of truth for configuration shape — add new options there first, then propagate to `buildConfig()` and the middlewares
- Tests use `tsconfig.test.json` which extends the base config with looser `module`/`moduleResolution` settings to support top-level `await` in test files

### Naming conventions

| Element | Convention |
|---|---|
| Environment variables | `AUTH_SERVICE_<SUFFIX>` (screaming snake case) |
| Config fields | camelCase mirror of the env var suffix (e.g. `AUTH_SERVICE_AUDIENCE` → `config.audience`) |
| Middleware class names | `Oidc<Scope><Type>Middleware` (e.g. `OidcSocketAdminMiddleware`) |
| Internal helpers | Module-level functions, unexported unless tested directly |

---

## Test suite

### Structure

```
tests/
├── setup.ts                                 # Global config — timeouts, console suppression
├── unit/
│   ├── buildConfig.test.ts                  # buildConfig() env var parsing
│   ├── jwks.test.ts                         # verifyOidcToken() — mocked jose
│   ├── OidcConfigManager.test.ts            # Manager lifecycle (start / getConfig)
│   ├── OidcHttpMiddleware.test.ts           # HTTP middleware — happy path + error paths
│   ├── OidcSocketMiddleware.test.ts         # Socket.IO middleware — same coverage
│   └── OidcSocketAdminMiddleware.test.ts    # Admin enforcement
└── integration/
    └── verifyOidcToken.integration.test.ts  # Real JWT signing + JWKS mock server
```

### Running tests

```bash
pnpm test                   # all tests (unit + integration)
pnpm run test:unit          # unit tests only
pnpm run test:integration   # integration tests only
pnpm run test:coverage      # coverage report (text + lcov + html)
pnpm run test:watch         # watch mode (development)
```

### Coverage targets

| Metric | Target |
|---|---|
| Statements | > 90% |
| Branches | > 85% |
| Functions | > 95% |
| Lines | > 90% |

### Writing tests

- **Unit tests** must mock `jose` and `ioserver` entirely — no real HTTP servers, no real JWKS endpoints
- **Integration tests** may spin up a minimal HTTP server on port **3030** to serve a mock JWKS; always shut it down in `afterAll`
- Each new `OidcConfig` field **requires**:
  1. A test in `buildConfig.test.ts` covering the env var → config mapping
  2. A test in `jwks.test.ts` (or the relevant middleware test) covering its effect on verification
- When mocking `jose`, always mock at the module level with `vi.mock("jose", ...)` before the import under test (top-level `await import(...)` pattern required for ESM)
- Test file names must match the source file name exactly (e.g. `src/jwks.ts` → `tests/unit/jwks.test.ts`)

---

## Linting

```bash
pnpm run lint        # report issues
pnpm run lint:fix    # auto-fix where possible
```

Configuration is in `eslint.config.js`. Lint warnings must not accumulate — resolve them before opening a PR.

---

## Commit conventions

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add audience field to OidcConfig for RFC 8707 resource support
fix: handle missing appHandle.users gracefully in OidcHttpMiddleware
docs: document AUTH_SERVICE_AUDIENCE in README
test: add audience fallback tests to jwks.test.ts
refactor: extract resolveIssuer helper to reduce duplication
chore: bump jose to 6.2
ci: add coverage upload step to build workflow
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, `ci`.

Breaking changes: append `!` to the type/scope and add a `BREAKING CHANGE:` footer:

```
feat!: rename appSlug to clientId in OidcConfig

BREAKING CHANGE: The `appSlug` field in `OidcConfig` is renamed to
`clientId` for consistency with OAuth 2.1 terminology. Update any
`OidcConfigManager` registrations and `buildConfig` callers accordingly.
```

---

## Pull requests

1. Fork the repository and create a feature branch from `main` (e.g. `feat/my-feature`)
2. Write or update tests for your change — every new `OidcConfig` field needs coverage in both `buildConfig.test.ts` and the relevant middleware/jwks test
3. Ensure `pnpm test` passes (all suites)
4. Ensure `pnpm run build` produces no TypeScript errors
5. Ensure `pnpm run lint` reports no warnings
6. Open a PR against `main` — the CI pipeline runs automatically on every PR
7. Address review comments; squash merge when approved

---

## Release process

Releases are cut by maintainers only:

1. Update `version` in `package.json` (or use `pnpm run version:patch / version:minor / version:major`)
2. Update `CHANGELOG.md` — move items from `[Unreleased]` to the new version section
3. Commit and push: `git commit -m "chore: release vX.Y.Z"`
4. Create a **GitHub Release** named `vX.Y.Z` — this triggers the publish workflow
5. The workflow automatically:
   - Builds and tests the package
   - Publishes to [GitHub Packages](https://github.com/x42en/ioserver-oidc/packages)

Pre-releases: release names containing `-` (e.g. `v0.2.0-beta.1`) are automatically marked as pre-release on GitHub.
