export default defineNuxtConfig({
  extends: ["docus"],
  app: {
    baseURL: process.env.NUXT_APP_BASE_URL ?? "/ioserver-oidc/",
  },
  site: {
    url: process.env.NUXT_SITE_URL ?? "https://docs.circle-cyber.com/ioserver-oidc",
  },
  llms: {
    title: "IOServer OIDC",
    description:
      "Drop-in OIDC/OAuth2 JWT middleware set for IOServer. Protects Fastify HTTP routes and Socket.IO namespaces via remote JWKS.",
    full: {
      title: "IOServer OIDC — Complete Documentation",
      description:
        "Complete documentation for ioserver-oidc, a middleware package that adds OIDC/OAuth2 JWT authentication to IOServer applications. Covers OidcConfigManager, OidcHttpMiddleware, OidcSocketMiddleware, OidcSocketAdminMiddleware, token verification, and user provisioning.",
    },
  },
});
