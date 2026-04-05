# ioserver-oidc

[![npm version](https://img.shields.io/npm/v/ioserver-oidc.svg)](https://www.npmjs.com/package/ioserver-oidc)
[![CI](https://github.com/x42en/ioserver-oidc/actions/workflows/ci.yml/badge.svg)](https://github.com/x42en/ioserver-oidc/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> OIDC/OAuth2 JWT middleware set for [IOServer](https://github.com/x42en/ioserver).  
> Protects Fastify HTTP routes **and** Socket.IO namespaces by verifying access
> tokens issued by [auth-service](https://github.com/x42en/auth-service)
> (BetterAuth + OAuth2 provider) via remote JWKS — **zero secret storage on the
> application side**.

---

## Table of contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [API reference](#api-reference)
  - [OidcConfigManager](#oidcconfigmanager)
  - [OidcHttpMiddleware](#oidchttpmiddleware)
  - [OidcSocketMiddleware](#oidcsocketmiddleware)
  - [OidcSocketAdminMiddleware](#oidcsocketadminmiddleware)
  - [verifyOidcToken](#verifyoidctoken)
  - [Types](#types)
- [Request / socket context](#request--socket-context)
- [Error codes](#error-codes)
- [Security notes](#security-notes)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- ✅ Verifies RS256 / ES256 JWT access tokens via **remote JWKS** (no secret distribution)
- ✅ Validates `iss`, `aud`, and expiry claims
- ✅ In-process JWKS **key cache** — one HTTP round-trip per key rotation
- ✅ Auto-provisions local user records via `appHandle.users.findOrCreate(...)`
- ✅ Rejects disabled accounts (403)
- ✅ Injects `sub`, `userId`, `userRole`, `roles`, `permissions`, `features` on every authenticated request/socket
- ✅ Admin role guard for Socket.IO namespaces
- ✅ Full TypeScript declarations; ESM-only

---

## Requirements

| Dependency | Version  |
|------------|----------|
| Node.js    | ≥ 20     |
| ioserver   | ≥ 2.0.0  |
| jose       | ≥ 6.0.0  |

---

## Installation

```bash
# npm
npm install ioserver-oidc

# pnpm
pnpm add ioserver-oidc

# yarn
yarn add ioserver-oidc
```

`jose` is bundled as a direct dependency — no extra installation required.

---

## Quick start

### 1. Register the config manager

```ts
import {
  OidcConfigManager,
  OidcHttpMiddleware,
  OidcSocketMiddleware,
  OidcSocketAdminMiddleware,
} from "ioserver-oidc";
import { IOServer } from "ioserver";

const server = new IOServer({ /* your IOServer options */ });

// Reads AUTH_SERVICE_URL + AUTH_SERVICE_APP_SLUG from process.env
server.addManager({ name: "oidcConfig", manager: OidcConfigManager });
```

### 2. Protect HTTP controllers

```ts
server.addController({
  name: "profile",
  controller: ProfileController,
  middlewares: [OidcHttpMiddleware],   // ← JWT-required
  prefix: "/profile",
});
```

### 3. Protect Socket.IO services

```ts
// Any authenticated user
server.addService({
  name: "chat",
  service: ChatService,
  middlewares: [OidcSocketMiddleware],
});

// Admin-only namespace
server.addService({
  name: "users",
  service: UserService,
  middlewares: [OidcSocketMiddleware, OidcSocketAdminMiddleware],
});
```

### 4. Read the injected context in your handlers

```ts
// HTTP (Fastify)
fastify.get("/me", async (request) => {
  const req = request as any;
  return { userId: req.userId, role: req.userRole };
});

// Socket.IO
socket.on("ping", () => {
  console.log(socket.userId, socket.userRole);
});
```

---

## Environment variables

| Variable               | Required | Default                                  | Description                                                  |
|------------------------|----------|------------------------------------------|--------------------------------------------------------------|
| `AUTH_SERVICE_URL`     | ✅        | —                                        | Public base URL of your auth-service. E.g. `https://auth.example.com` |
| `AUTH_SERVICE_APP_SLUG`| ✅        | —                                        | OAuth2 `client_id` / app slug registered in auth-service    |
| `AUTH_SERVICE_JWKS_URI`| ❌        | `<AUTH_SERVICE_URL>/api/auth/jwks`       | Override the JWKS endpoint                                   |
| `AUTH_SERVICE_ISSUER`  | ❌        | `<AUTH_SERVICE_URL>`                     | Override the expected `iss` claim                            |

All variables are read **once** at server startup by `OidcConfigManager.start()`.  
If `OidcConfigManager` is not registered, each middleware reads the same
variables lazily on first request (without caching between restarts).

---

## API reference

### `OidcConfigManager`

Extends `BaseManager`. Reads environment variables and exposes the resolved
`OidcConfig` to sibling middlewares via `appHandle.oidcConfig.getConfig()`.

```ts
server.addManager({ name: "oidcConfig", manager: OidcConfigManager });
```

> The name **must** be `"oidcConfig"` — the middlewares look for
> `appHandle.oidcConfig` by that exact key.

---

### `OidcHttpMiddleware`

Extends `BaseMiddleware`. Verifies the `Authorization: Bearer <token>` header on
every inbound Fastify request.

**Flow:**
1. Extracts the Bearer token from `Authorization` header
2. Verifies JWT signature via JWKS (`iss` + `aud` + expiry)
3. Calls `appHandle.users.findOrCreate(sub, { email, name })` if available
4. Rejects disabled accounts with `403`
5. Injects auth context onto the request object

**Returns** `401` on missing/invalid tokens, `403` on disabled accounts,
`500` if user provisioning fails.

---

### `OidcSocketMiddleware`

Same as `OidcHttpMiddleware` but for Socket.IO connections.

Token is read from (in order):
1. `socket.handshake.auth.token` — preferred, set by the Vue/web client
2. `socket.handshake.headers.authorization` (`Bearer` prefix) — fallback

Calls `appHandle.session.registerSocket(userId, socketId, sub)` when the
session manager is available.

**Rejects** with `new Error("ERR_AUTH_TOKEN_REQUIRED")` or
`"ERR_AUTH_TOKEN_INVALID"` on failure.

---

### `OidcSocketAdminMiddleware`

Role guard. Must be placed **after** `OidcSocketMiddleware` in the middlewares
array (relies on `socket.roles`/`socket.userRole` being already set).

**Rejects** with `new Error("ERR_FORBIDDEN")` when the user does not hold
the `"admin"` role.

---

### `verifyOidcToken`

Low-level function — use this if you need to verify a token outside of the
IOServer middleware system.

```ts
import { verifyOidcToken } from "ioserver-oidc";

const ctx = await verifyOidcToken(rawJwt, {
  authServiceUrl: "https://auth.example.com",
  appSlug: "my-app",
});
// ctx → OidcUserContext
```

Throws a `jose` `JWTVerifyError` (or subclass) on any verification failure.

---

### Types

```ts
import type { OidcConfig, OidcUserContext, OidcFeatures } from "ioserver-oidc";
```

#### `OidcConfig`

```ts
interface OidcConfig {
  authServiceUrl: string;   // e.g. "https://auth.example.com"
  appSlug:        string;   // OAuth2 client_id (= app slug)
  jwksUri?:       string;   // Override JWKS endpoint
  issuer?:        string;   // Override expected `iss` claim
}
```

#### `OidcUserContext`

```ts
interface OidcUserContext {
  userId:      string;         // Local DB user ID (after findOrCreate)
  sub:         string;         // OIDC sub claim
  email:       string | null;
  name:        string | null;
  userRole:    string;         // First element of roles[], fallback "user"
  roles:       string[];
  permissions: string[];
  features:    OidcFeatures;   // Record<string, unknown>
}
```

---

## Request / socket context

After successful authentication the following properties are available:

| Property      | Type                    | Source                         |
|---------------|-------------------------|--------------------------------|
| `sub`         | `string`                | JWT `sub` claim                |
| `userId`      | `string`                | Local DB `users.id`            |
| `userRole`    | `string`                | `roles[0]` or `"user"`         |
| `roles`       | `string[]`              | JWT `roles` claim              |
| `permissions` | `string[]`              | JWT `permissions` claim        |
| `features`    | `Record<string,unknown>`| JWT `features` claim           |

In TypeScript, cast the Fastify `request` or Socket.IO `socket` to `any` (or
augment the types in your app) to access these properties.

---

## Error codes

| Code                      | HTTP / Socket | Meaning                                  |
|---------------------------|---------------|------------------------------------------|
| `ERR_AUTH_TOKEN_REQUIRED` | 401 / reject  | No `Authorization` header or auth token  |
| `ERR_AUTH_TOKEN_INVALID`  | 401 / reject  | JWT signature / claims verification failed|
| `ERR_USER_DISABLED`       | 403           | User account is disabled in the local DB |
| `ERR_USER_PROVISION_FAILED`| 500          | `findOrCreate` threw an error            |
| `ERR_FORBIDDEN`           | — / reject    | User lacks the required role             |

---

## Security notes

- Access tokens are **never stored** — they are verified in-memory on every
  request/connection using the cached JWKS.
- JWKS keys are fetched lazily and cached per URI. The `jose` library
  automatically re-fetches keys on signature verification failure (key rotation)
  with a minimum 5-minute cooldown.
- The `aud` (audience) claim is always validated against `OidcConfig.appSlug`
  to prevent token substitution attacks between different applications sharing
  the same auth-service instance.
- The `iss` (issuer) claim is validated against `OidcConfig.authServiceUrl`
  (or the explicit override).

---

## Contributing

1. Fork the repo and create a branch: `git checkout -b feat/my-feature`
2. Make your changes (TypeScript in `src/`)
3. Build: `pnpm run build`
4. Open a Pull Request against `main`

---

## License

[MIT](LICENSE) © 2026 [x42en](https://github.com/x42en)
