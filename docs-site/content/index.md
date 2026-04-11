---
seo:
  title: IOServer OIDC — OIDC/OAuth2 middleware for IOServer
  description: Drop-in OIDC/OAuth2 JWT middleware set for IOServer. Protects Fastify HTTP routes and Socket.IO namespaces via remote JWKS — no secret storage on the application side.
---

:::u-page-hero
#title
IOServer OIDC

#description
Drop-in OIDC/OAuth2 JWT authentication for [IOServer](https://docs.circle-cyber.com/ioserver/) applications. Protects HTTP routes and Socket.IO namespaces by verifying tokens issued by your auth-service via remote JWKS — no secrets to store, no key rotation to manage.

#links
::::u-button{to="/docs/getting-started/introduction" size="xl" trailing-icon="i-lucide-arrow-right" color="neutral"}
Get started
::::

::::u-button{to="https://github.com/x42en/ioserver-oidc" target="_blank" size="xl" variant="outline" color="neutral" icon="i-simple-icons-github"}
GitHub
::::
:::

:::u-page-section
#title
What it does

#features
::::u-page-feature{icon="i-lucide-shield-check" title="JWT verification via JWKS" description="RS256/ES256 tokens are verified against your auth-service's public key set. Keys are fetched once and cached in-process; rotation is handled automatically by jose."}
::::

::::u-page-feature{icon="i-lucide-zap" title="HTTP and WebSocket in one package" description="OidcHttpMiddleware guards Fastify routes. OidcSocketMiddleware guards Socket.IO namespaces. Both follow the exact same token flow and inject the same user context."}
::::

::::u-page-feature{icon="i-lucide-user-check" title="User auto-provisioning" description="On first access, the middleware calls appHandle.users.findOrCreate() to create a local user record from the OIDC subject. Disabled accounts are rejected with 403."}
::::

::::u-page-feature{icon="i-lucide-lock" title="Role-based access control" description="OidcSocketAdminMiddleware provides a ready-to-use admin guard. Chain it after OidcSocketMiddleware to restrict a Socket.IO namespace to admin users only."}
::::

::::u-page-feature{icon="i-lucide-package" title="Zero secret storage" description="Access tokens are verified in-memory on every request using the cached JWKS. No token is stored on disk or in a database on the application side."}
::::

::::u-page-feature{icon="i-lucide-code" title="Full TypeScript support" description="Ships with declaration files for OidcConfig, OidcUserContext, and OidcFeatures. ESM-only distribution; strict mode compatible."}
::::
:::
