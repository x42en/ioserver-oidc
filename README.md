# ioserver-oidc

[![npm version](https://badge.fury.io/js/ioserver-oidc.svg)](https://badge.fury.io/js/ioserver-oidc)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![CI Build](https://github.com/x42en/ioserver-oidc/actions/workflows/build.yml/badge.svg)](https://github.com/x42en/ioserver-oidc/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0+-blue.svg)](https://www.typescriptlang.org/)

> OIDC/OAuth2 JWT middleware set for [IOServer](https://github.com/x42en/ioserver).
> Protects Fastify HTTP routes **and** Socket.IO namespaces. Native support for
> [CIRCLE auth-service](https://github.com/circle-rd/auth-service) is the
> default; any other standards-compliant OAuth 2.x / OIDC issuer remains
> supported.

- Native auth-service token format, including roles, permissions, plan
  features, organizations, LiteLLM audiences, wallet reads and back-channel
  logout.
- Generic OIDC/OAuth2 provider mode with configurable claim names.
- Remote JWKS verification with an asymmetric algorithm allow-list and
  authorized-party binding.
- Auto-provisioning through `appHandle.users.findOrCreate(...)`.
- LiteLLM gateway client, auth-service wallet client, machine API, resource
  authorization, signed resource webhooks and self-service teams built on
  [`@circle-rd/auth-ai`](https://docs.circle-cyber.com/auth-ai/typescript/).
- Full TypeScript declarations; ESM-only.

---

## Table of contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Providers](#providers)
- [Environment variables](#environment-variables)
- [API reference](#api-reference)
- [Request / socket context](#request--socket-context)
- [LiteLLM and the credit wallet](#litellm-and-the-credit-wallet)
- [Machine API and resource sharing](#oidcmachinemanager)
- [Teams and organizations](#teams-and-organizations)
- [Resource webhooks](#resource-webhooks)
- [Protected-resource metadata](#protected-resource-metadata)
- [Back-channel logout](#back-channel-logout)
- [Error codes](#error-codes)
- [Security notes](#security-notes)
- [Contributing](#contributing)
- [License](#license)

---

## Requirements

| Dependency         | Version |
| ------------------ | ------- |
| Node.js            | ≥ 22    |
| ioserver           | ≥ 2.3.0 |
| TypeScript         | ≥ 6.0   |
| @circle-rd/auth-ai | ≥ 0.5   |

`jose`, `zod` and `@circle-rd/auth-ai` are direct dependencies; no extra
installation is required.

---

## Installation

```bash
# pnpm (recommended)
pnpm add ioserver-oidc

# npm
npm install ioserver-oidc

# yarn
yarn add ioserver-oidc
```

The package is ESM-only. Your `tsconfig.json` must target ES2022 or later and
use `"module": "NodeNext"` or `"module": "ESNext"`.

---

## Quick start

### 1. Register the config manager

```ts
import { IOServer } from "ioserver";
import {
  OidcConfigManager,
  OidcHttpMiddleware,
  OidcSocketMiddleware,
  OidcSocketAdminMiddleware,
} from "ioserver-oidc";

const server = new IOServer({/* your options */});

// Reads AUTH_SERVICE_URL + AUTH_SERVICE_APP_SLUG from process.env.
server.addManager({ name: "oidcConfig", manager: OidcConfigManager });
```

The manager name **must** be `"oidcConfig"`: the middlewares look it up by that
exact key.

### 2. Protect HTTP controllers

```ts
server.addController({
  name: "profile",
  controller: ProfileController,
  middlewares: [OidcHttpMiddleware],
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

// Users holding one of the configured admin roles (default: "admin")
server.addService({
  name: "users",
  service: UserService,
  middlewares: [OidcSocketMiddleware, OidcSocketAdminMiddleware],
});
```

### 4. Read the injected context

```ts
// HTTP (Fastify)
fastify.get("/me", async (request) => {
  const req = request as any;
  return {
    userId: req.userId,
    role: req.userRole,
    plan: req.plan,
    canUseApi: req.features.apiAccess === true,
  };
});

// Socket.IO
socket.on("ping", () => {
  console.log(socket.userId, socket.userRole, socket.plan);
});
```

### 5. Native environment

```env
AUTH_SERVICE_URL=https://auth.example.com
AUTH_SERVICE_APP_SLUG=my-app
AUTH_SERVICE_AUDIENCE=https://api.example.com
# Optional: enables createRequestGatewayClient()
AUTH_SERVICE_GATEWAY_URL=https://llm.example.com
```

---

## Providers

### `auth-service` (default)

`OIDC_PROVIDER` is unset or `auth-service`. The package validates the native
auth-service access token:

- `iss` = `AUTH_SERVICE_URL` (or `AUTH_SERVICE_ISSUER`).
- `aud` = `AUTH_SERVICE_AUDIENCE` (RFC 8707 resource URL), or
  `AUTH_SERVICE_APP_SLUG` for legacy deployments.
- `azp` / `client_id` = `AUTH_SERVICE_APP_SLUG`.
- Claims: `roles`, `permissions`, `features`, `plan`, `org_id`, `scope`, `sid`.
- `client_credentials` tokens (`sub === azp`) are rejected by default.

### `oidc` (generic provider)

```env
OIDC_PROVIDER=oidc
OIDC_ISSUER=https://login.example.com
OIDC_JWKS_URI=https://login.example.com/.well-known/jwks.json
OIDC_AUDIENCE=api://my-api
OIDC_CLIENT_ID=my-client
```

Generic mode keeps the same middlewares and context shape. Claim names are
configurable when a provider does not use the auth-service names:

```env
OIDC_ROLES_CLAIM=groups
OIDC_PERMISSIONS_CLAIM=scp
OIDC_FEATURES_CLAIM=entitlements
OIDC_ORG_ID_CLAIM=tenant
OIDC_AUTHORIZED_PARTY_CLAIMS=azp,appid
```

Native and generic modes share the same verification guarantees: asymmetric
algorithms only, required `exp`/`iss`/`aud`/`sub`, access-token type checks,
and authorized-party binding. `OIDC_CLIENT_ID` is required so the binding is
never silently disabled.

---

## Environment variables

### Native auth-service mode

| Variable                                  | Required | Default                            | Description                                                     |
| ----------------------------------------- | -------- | ---------------------------------- | --------------------------------------------------------------- |
| `AUTH_SERVICE_URL`                        | Yes      | —                                  | Public base URL of auth-service (`BETTER_AUTH_URL`).            |
| `AUTH_SERVICE_APP_SLUG`                   | Yes      | —                                  | OAuth2 `client_id` / application slug.                          |
| `AUTH_SERVICE_AUDIENCE`                   | No       | `AUTH_SERVICE_APP_SLUG`            | Expected `aud` (RFC 8707 resource URL). Set it to your API URL. |
| `AUTH_SERVICE_JWKS_URI`                   | No       | `<AUTH_SERVICE_URL>/api/auth/jwks` | Override the JWKS endpoint.                                     |
| `AUTH_SERVICE_ISSUER`                     | No       | `AUTH_SERVICE_URL`                 | Override the expected `iss`.                                    |
| `AUTH_SERVICE_GATEWAY_URL`                | No       | —                                  | LiteLLM gateway URL used by `createRequestGatewayClient()`.     |
| `AUTH_SERVICE_TOKEN_TYP`                  | No       | —                                  | Required JOSE `typ` header for access tokens (e.g. `at+jwt`).   |
| `OIDC_RESOURCE_METADATA_URL`              | No       | —                                  | RFC 9728 metadata URL used in the Bearer challenge.             |
| `OIDC_SCOPES_SUPPORTED`                   | No       | —                                  | Comma-separated scopes advertised in metadata.                  |
| `AUTH_SERVICE_CLIENT_SECRET`              | No       | —                                  | Confidential client secret for `OidcMachineManager`.            |
| `AUTH_SERVICE_MACHINE_REDIRECT_URI`       | No       | `<issuer>/__ioserver_oidc_machine` | Technical redirect URI used by the machine client.              |
| `AUTH_SERVICE_TOKEN_ENDPOINT_AUTH_METHOD` | No       | `client_secret_basic`              | `client_secret_basic` or `client_secret_post`.                  |
| `AUTH_SERVICE_ALLOW_MACHINE_TOKENS`       | No       | `false`                            | Accept `client_credentials` tokens on user routes.              |
| `AUTH_SERVICE_ADMIN_ROLES`                | No       | `admin`                            | Comma-separated roles accepted by `OidcSocketAdminMiddleware`.  |
| `OIDC_ALLOW_INSECURE_HTTP`                | No       | `false`                            | Allow plain HTTP to non-loopback services.                      |

### Generic OIDC mode

| Variable                       | Required | Default               | Description                                         |
| ------------------------------ | -------- | --------------------- | --------------------------------------------------- |
| `OIDC_PROVIDER`                | Yes      | —                     | Set to `oidc`.                                      |
| `OIDC_ISSUER`                  | Yes      | —                     | Token issuer.                                       |
| `OIDC_JWKS_URI`                | Yes      | —                     | JWKS endpoint.                                      |
| `OIDC_AUDIENCE`                | Yes      | —                     | Expected `aud`.                                     |
| `OIDC_CLIENT_ID`               | Yes      | —                     | Client id used for authorized-party binding.        |
| `OIDC_ALGORITHMS`              | No       | asymmetric allow-list | Comma-separated JWS algorithms.                     |
| `OIDC_ALLOW_MACHINE_TOKENS`    | No       | `false`               | Accept tokens without an end user.                  |
| `OIDC_ADMIN_ROLES`             | No       | `admin`               | Admin roles for the Socket.IO guard.                |
| `OIDC_CLOCK_TOLERANCE_SECONDS` | No       | `5`                   | Accepted clock skew (0–300).                        |
| `OIDC_TOKEN_TYP`               | No       | —                     | Required JOSE `typ` header for access tokens.       |
| `OIDC_ALLOW_INSECURE_HTTP`     | No       | `false`               | Allow plain HTTP to non-loopback services.          |
| `OIDC_RESOURCE_METADATA_URL`   | No       | —                     | RFC 9728 metadata URL used in the Bearer challenge. |
| `OIDC_SCOPES_SUPPORTED`        | No       | —                     | Comma-separated scopes advertised in metadata.      |
| `OIDC_*_CLAIM`                 | No       | auth-service names    | Claim-name overrides (see [Providers](#providers)). |

All variables are validated by the `OidcConfigManager` constructor, so invalid
configuration fails startup. Without the manager, the middlewares build the
configuration lazily on first use.

---

## API reference

### `OidcConfigManager`

Extends `BaseManager`. Reads and validates the environment in its constructor,
and exposes the resolved `OidcConfig` through `appHandle.oidcConfig.getConfig()`.

```ts
server.addManager({ name: "oidcConfig", manager: OidcConfigManager });
```

### `OidcHttpMiddleware`

Extends `BaseMiddleware`. Verifies `Authorization: Bearer <token>` on every
inbound Fastify request.

Flow:

1. Extract the bearer token.
2. Resolve the config from `appHandle.oidcConfig`, or from the environment.
3. Verify the JWT signature, required `exp`/`iss`/`aud`/`sub`, `azp`, token
   type and expiry.
4. Reject `client_credentials` tokens unless explicitly allowed; allowed machine
   tokens are never auto-provisioned as local users.
5. Call `appHandle.users.findOrCreate(sub, { email, name })` when available.
6. Reject disabled accounts with `403`.
7. Inject the auth context onto the request and set cache/auth headers.

Returns `401` on missing/invalid tokens, `403` on refused machine tokens or
disabled accounts, `500` when user provisioning fails, and `503` with
`ERR_OIDC_CONFIG` when OIDC configuration is unavailable.

### `OidcSocketMiddleware`

Same checks for Socket.IO handshakes. The token is read from
`socket.handshake.auth.token`, then from the `Authorization: Bearer` header. It
also calls `appHandle.session.registerSocket(...)` when the session manager is
available.

### `OidcSocketAdminMiddleware`

Role guard. Place it after `OidcSocketMiddleware`. It accepts any role listed in
`adminRoles` (default `["admin"]`) and rejects with `ERR_FORBIDDEN` otherwise.

### `verifyOidcToken`

Low-level verifier for custom Fastify plugins, background jobs or CLIs.

```ts
import { verifyOidcToken } from "ioserver-oidc";

const ctx = await verifyOidcToken(rawJwt, {
  authServiceUrl: "https://auth.example.com",
  appSlug: "my-app",
  audience: "https://api.example.com",
});
```

Throws a `jose` `JWTVerifyError` (or subclass) on signature/claim failure, and
`OidcTokenError` when a machine token is refused.

### `createGatewayClient` / `createRequestGatewayClient`

Build a LiteLLM gateway client from a user token minted for the gateway
audience. The token is the API key; the gateway debits the wallet after each
call.

```ts
import { createRequestGatewayClient } from "ioserver-oidc";

const gateway = createRequestGatewayClient(request, config);
const models = await gateway.listModels();
const mcpUrl = gateway.mcpUrl("github");
```

The returned `GatewayClient` is the one from `@circle-rd/auth-ai`: it exposes
`openAiBaseUrl`, `fetch`, `getAccessToken()`, `listModels()`, `listAgents()`,
`listMcpServers()`, `mcpUrl()` and `postJson()`.

### `createWalletClient`

Read the signed-in user's auth-service credit wallet. The token must carry the
`wallet:self:read` scope and be minted for the auth-service audience.

```ts
import { createWalletClient } from "ioserver-oidc";

const wallet = createWalletClient({
  authServiceUrl: config.authServiceUrl,
  token: request.authToken,
});

const account = await wallet.getAccount(); // balance: bigint micro-euros
if (!account.canSpend) {
  return reply.redirect(wallet.topupUrl());
}
const stats = await wallet.getStats({ days: 30 });
```

Methods: `getAccount()`, `getStats({ days })`, `getSessionUsage(sessionId, { days })`,
`listTransactions({ limit, cursor, type })`, `getTopupOptions()` and
`topupUrl()`.

### `OidcMachineManager`

Exposes the auth-service machine API (`resources`, `billing`, `consumption`)
through `appHandle.oidcMachine`. It is native auth-service only and requires a
confidential client secret.

```ts
server.addManager({ name: "oidcConfig", manager: OidcConfigManager });
server.addManager({ name: "oidcMachine", manager: OidcMachineManager });
```

```env
AUTH_SERVICE_CLIENT_SECRET=<confidential-client-secret>
```

The secret is never stored in `OidcConfig`, logged, or copied onto requests.
Methods use the published auth-ai names (`resources`, `billing`, and
`consumption.listAggregates/getAggregate`).
`resources:authorize` is a platform scope: grant it only to a trusted adapter.
`resources:validate` is enough for a scheme validator; `resources:usage:write`
is reserved for metering components.

### Teams and organizations

`createOrganizationsClient()` returns the signed-in user's auth-service
`OrganizationsClient`, using the token already verified by the OIDC middleware.
The token must be minted for the auth-service audience and carry
`organizations:self:manage` (exported as `ORGANIZATION_SELF_SCOPE`).

```ts
import { createOrganizationsClient } from "ioserver-oidc";

const organizations = createOrganizationsClient({
  config,
  token: request.authToken,
});

const teams = await organizations.listOrganizations({ team: true });
const team = await organizations.create({ name: "Acme Team" });
const invitation = await organizations.createInvitationToken(team.id);
await organizations.join(invitation.token);
```

Methods: `listOrganizations({ team? })`, `create({ name, logo? })`, `join(token)`,
`leave(id)`, `createInvitationToken(id)` and `revokeInvitationToken(id)`. The
`Organization` and `InvitationToken` types plus their Zod schemas are
re-exported. auth-service stays the decision point; refusals carry an `ORG_*`
`apiCode` in the auth-ai `API_001` details.

When sign-in is handled by `@circle-rd/auth-ai`, enable `teamManagement: true`
on the `AuthClient` so the scope and auth-service audience are requested.

### Resource authorization

`requireResourceAccess()` asks auth-service whether the **verified** user may
use a resource. A deny, a timeout or a malformed answer is a refusal; only an
explicit `decision: "allow"` returns.

```ts
import { requireResourceAccess } from "ioserver-oidc";

const access = await requireResourceAccess(
  this.appHandle,
  request,
  "gine://project-42",
  { requestId: request.id, source: "api" },
);
// request.resourceAccess is set; access.accessKind is "owner" or "grant"
```

It takes `sub`, the actor client (`azp`, audit only) and the audience from the
verified context, never from user input; `{ permission: "write" }` asks for the
level needed to act. The allowed decision carries the `decisionId` that
`recordResourceUsage()` requires and the effective `permission`. Other helpers:
`listAccessibleResources()` (filter only), `validateResource()`,
`invalidateResource()` and `recordResourceUsage()`.

`createResourceSharingClient()` returns the signed-in user's grant client
(`createGrant` with `permission: "read" | "write"`, `updateGrant`, `revokeGrant`,
`deleteGrant`, `shareWithApplication`), from a verified token carrying
`resources:self:manage`. See the [resource sharing guide](docs-site/content/docs/api/11.resource-sharing.md).

### Resource webhooks

```ts
import { registerResourceWebhook } from "ioserver-oidc";

registerResourceWebhook(server.getApp(), {
  secret: process.env.AUTH_SERVICE_RESOURCE_WEBHOOK_SECRET!,
  onEvent: async (event) => {
    await grants.sync(event);
  },
});
```

The raw JSON body is verified against `X-Auth-Service-Signature` in an
encapsulated parser scope, so other JSON routes are unchanged. Deliveries are
deduplicated on `eventId`; pass a shared `replayStore` across replicas. The
route is outside OIDC authentication and answers `204` (or `400`/`500` with no
detail).

### Protected-resource metadata

```ts
import { registerProtectedResourceMetadata } from "ioserver-oidc";

registerProtectedResourceMetadata(server.getApp(), {
  config: buildConfig(),
  scopesSupported: ["gine:read", "gine:write"],
});
```

This serves RFC 9728 metadata. Set `OIDC_RESOURCE_METADATA_URL` and
`OIDC_SCOPES_SUPPORTED` to advertise it in `WWW-Authenticate` challenges.

### `registerBackchannelLogout`

Mount the OIDC Back-Channel Logout 1.0 endpoint on the Fastify instance exposed
by IOServer.

```ts
import { buildConfig, registerBackchannelLogout } from "ioserver-oidc";

registerBackchannelLogout(server.getApp(), {
  config: buildConfig(),
  onLogout: async ({ sid, sub }) => {
    await sessions.endBySid(sid, sub);
  },
});
```

Call it **before `server.start()`**: it registers a Fastify route and, when
absent, a form-body parser. The default path is `/auth/backchannel-logout`. The handler verifies the logout
token with the auth-ai SDK (signature, `typ`, audience, event, lifetime and
replay) and answers `200`; responses never carry error detail. Share the
`replayStore` across replicas in production. For a known provider that omits
the logout-token `typ`, pass `allowMissingTyp: true` explicitly.

### Entitlement helpers

The auth-service claim helpers are re-exported from `@circle-rd/auth-ai`:

```ts
import { getFeature, hasFeature, hasPermission, hasRole } from "ioserver-oidc";

hasRole(ctx, "admin");
hasPermission(ctx, "reports", "write"); // write implies read
hasFeature(ctx, "beta");
getFeature(ctx, "seats");
```

### Types

```ts
import type {
  OidcConfig,
  OidcUserContext,
  OidcFeatures,
  OidcClaimMapping,
  OidcProvider,
  Organization,
  InvitationToken,
  CreateOrganizationInput,
  ListOrganizationsOptions,
  AuthServiceOrganizationsOptions,
} from "ioserver-oidc";
```

---

## Request / socket context

After successful authentication:

| Property      | Type                     | Source                                          |
| ------------- | ------------------------ | ----------------------------------------------- |
| `sub`         | `string`                 | JWT `sub` claim                                 |
| `userId`      | `string`                 | Local `users.id`, else `sub`                    |
| `userRole`    | `string`                 | Local role, else `roles[0]`, else `"user"`      |
| `roles`       | `string[]`               | `roles` claim                                   |
| `permissions` | `string[]`               | `permissions` claim                             |
| `features`    | `Record<string,unknown>` | `features` claim                                |
| `plan`        | `string \| null`         | `plan` claim                                    |
| `sid`         | `string \| null`         | Provider session id                             |
| `clientId`    | `string \| null`         | `azp` / `client_id`                             |
| `scopes`      | `string[]`               | `scope` claim split on spaces                   |
| `isMachine`   | `boolean`                | True for an accepted `client_credentials` token |
| `audiences`   | `string[]`               | Verified `aud` claim values                     |
| `org_id`      | `string`                 | `org_id` claim, only when present               |
| `auth`        | `OidcUserContext`        | The complete verified context                   |
| `authToken`   | `string`                 | Raw bearer token; never log it                  |

---

## LiteLLM and the credit wallet

When the auth-service application has **LiteLLM support** enabled, its
`allowedResources` contains the gateway URL and the auth-service URL, and the
`wallet:self:read` scope is granted. The frontend then requests all three
audiences (`resource` repeated) and mints one short-lived token per audience.

On the IOServer side:

1. Verify the user token with `OidcHttpMiddleware`.
2. Read `canSpend` with `createWalletClient()` before an expensive job; fail
   closed and send the user to `topupUrl()` when it is false.
3. Call the gateway through `createRequestGatewayClient()` with the token minted
   for the gateway audience.

The gateway debits the wallet after each call. The application never debits
anything itself and holds no provider API key.

See the auth-service guides:
[LiteLLM gateway](https://docs.circle-cyber.com/auth-service/docs/guides/integration/litellm-gateway)
and [LiteLLM gateway and credit wallet in an application](https://docs.circle-cyber.com/auth-service/docs/guides/integration/litellm-app).

---

## Back-channel logout

Store the `sid` from the verified token at sign-in. Register
`registerBackchannelLogout` with an `onLogout` callback that ends every local
session bound to that `sid`. The SDK validates the logout token; the callback
must be idempotent.

In tests, a replay of the same `jti` is rejected. In production with several
replicas, provide a shared `ReplayStore` implementation.

---

## Error codes

| Code                          | HTTP / Socket | Meaning                                              |
| ----------------------------- | ------------- | ---------------------------------------------------- |
| `ERR_AUTH_TOKEN_REQUIRED`     | 401 / reject  | No bearer token                                      |
| `ERR_AUTH_TOKEN_INVALID`      | 401 / reject  | Signature or claims verification failed              |
| `ERR_MACHINE_TOKEN_FORBIDDEN` | 403 / reject  | `client_credentials` token refused on a user route   |
| `ERR_ACCOUNT_DISABLED`        | 403 / reject  | Local user record is disabled                        |
| `ERR_USER_PROVISION_FAILED`   | 500 / reject  | `users.findOrCreate` or session registration threw   |
| `ERR_OIDC_CONFIG`             | 503 / reject  | OIDC configuration is unavailable                    |
| `ERR_RESOURCE_FORBIDDEN`      | app-defined   | Resource access was denied or could not be decided   |
| `ERR_RESOURCE_CONFIG`         | 500 / throw   | Missing machine manager, subject, client or audience |
| `ERR_FORBIDDEN`               | — / reject    | Missing an accepted admin role                       |

Wallet, gateway and organizations helpers use the auth-ai registry (`API_001`,
`API_002`, `GW_001`–`GW_005`, `CFG_001`); organization refusals carry `ORG_*`
in `details.apiCode`. `GW_001` means the wallet cannot pay (HTTP 402).

---

## Security notes

- Access tokens are never stored; they are verified in memory on each request
  or handshake with the cached JWKS. Tokens are bounded to 16 KiB before
  parsing.
- JWKS keys are cached per URI. `jose` re-fetches on an unknown key with a
  cooldown, so key rotation is picked up without a restart.
- Only asymmetric algorithms are accepted (`RS*`, `PS*`, `ES*`, `EdDSA`);
  `HS*` and `none` are rejected.
- `iss`, `aud`, `exp` and `sub` are required and validated.
- ID-token markers (`nonce`, `at_hash`, `c_hash`), `token_use` other than
  `access`, and explicit `id+jwt`/`logout+jwt` types are rejected. Set
  `OIDC_TOKEN_TYP` when the provider uses a dedicated access-token type.
- `azp` / `client_id` is bound to the configured client id and is mandatory in
  resource-audience mode. `OIDC_CLIENT_ID` is required in generic mode.
- `client_credentials` tokens are refused by default for both providers.
- OIDC and gateway/wallet URLs must use HTTPS; plain HTTP is accepted only for
  loopback development or with the explicit `OIDC_ALLOW_INSECURE_HTTP` opt-in.
- The raw token is exposed to handlers as `authToken`; never log it or include
  it in an error response.
- Resource authorization is fail-closed: only `decision: "allow"` returns, and
  `subject` and audience come from the verified context; the client is sent as
  `actorClientId`, for the audit log only.
- Resource webhooks use HMAC over the raw body with timestamp and `eventId`
  replay protection; mount them outside OIDC authentication.
- `AUTH_SERVICE_CLIENT_SECRET` is read by `OidcMachineManager` only and is never
  stored in `OidcConfig` or written to logs.
- Authenticated HTTP responses carry `Vary: Authorization` and
  `Cache-Control: private, no-store`; 401 responses carry a Bearer challenge.
- The generic `oidc` mode trusts the configured issuer and JWKS URLs; never
  derive them from a request header.

---

## Contributing

1. Fork the repo and create a branch: `git checkout -b feat/my-feature`.
2. Make your changes in `src/`.
3. Run `pnpm format`, `pnpm build`, `pnpm lint`, `pnpm test` and
   `pnpm test:coverage`.
4. Open a pull request against `develop`.

See [AGENTS.md](AGENTS.md) for the implementation contract.

---

## License

[MIT](LICENSE) © 2026 [x42en](https://github.com/x42en)
