---
seo:
  title: IOServer OIDC — auth-service and OIDC middleware for IOServer
  description: Native auth-service support plus generic OIDC/OAuth2 JWT verification for IOServer HTTP routes and Socket.IO namespaces. LiteLLM gateway, wallet reads and back-channel logout included.
---

:::u-page-hero
#title
IOServer OIDC

#description
Native [CIRCLE auth-service](https://docs.circle-cyber.com/auth-service/) token
verification for [IOServer](https://docs.circle-cyber.com/ioserver/), with
generic OIDC/OAuth2 providers still supported. Protect Fastify routes and
Socket.IO namespaces, read entitlements and the credit wallet, call the LiteLLM
gateway on behalf of a user, and receive back-channel logout events.

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
::::u-page-feature{icon="i-lucide-shield-check" title="Native auth-service format" description="Roles, permissions, plan features, organizations, session ids and authorized-party binding are decoded from the auth-service access token. client_credentials tokens are refused by default."}
::::

::::u-page-feature{icon="i-lucide-waypoints" title="Keep other OIDC providers" description="Set OIDC_PROVIDER=oidc to verify any standards-compliant issuer through its JWKS. Claim names and authorized-party claims are configurable."}
::::

::::u-page-feature{icon="i-lucide-bot" title="LiteLLM gateway and wallet" description="Build a gateway client from the user token, read their credit with canSpend, link to the top-up page and map 402/429/503 gateway errors through @circle-rd/auth-ai."}
::::

::::u-page-feature{icon="i-lucide-log-out" title="Back-channel logout" description="Mount the OIDC Back-Channel Logout endpoint on IOServer. Signature, typ, audience, event, lifetime and replay checks are handled by the auth-ai SDK."}
::::

::::u-page-feature{icon="i-lucide-zap" title="HTTP and WebSocket" description="OidcHttpMiddleware guards Fastify routes. OidcSocketMiddleware guards Socket.IO namespaces. Both inject the same typed user context."}
::::

::::u-page-feature{icon="i-lucide-user-check" title="User provisioning" description="Optionally create the local user on first access with users.findOrCreate(), and reject disabled accounts on the next request."}
::::
:::
