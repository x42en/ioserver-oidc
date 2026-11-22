import type { OidcClaimMapping } from "./types.js";

/** Default claim names, shared by the native and generic providers. */
export const DEFAULT_CLAIM_MAPPING: OidcClaimMapping = Object.freeze({
  roles: "roles",
  permissions: "permissions",
  features: "features",
  plan: "plan",
  orgId: "org_id",
  email: "email",
  name: "name",
  picture: "picture",
  company: "company",
  authorizedParty: Object.freeze(["azp", "client_id"]),
});
