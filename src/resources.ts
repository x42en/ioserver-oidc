/**
 * Resource-sharing helpers for auth-service.
 *
 * @version 0.4.0
 * @since 0.4.0
 */

import type { AppHandle } from "ioserver";
import type {
  AccessibleResource,
  AuthorizeDecision,
  ListAccessibleOptions,
  ResourceState,
  UsageReceipt,
  UsageRecord,
  ValidationOutcome,
} from "@circle-rd/auth-ai/server";
import { OidcResourceError } from "./errors.js";
import type { OidcConfig, OidcUserContext } from "./types.js";

export type AllowedResource = Extract<AuthorizeDecision, { decision: "allow" }>;

export interface ResourceAccessOptions {
  /** Resource audience; defaults to the token `aud` or configured audience. */
  readonly audience?: string;
  /** Correlates the access with the caller's request id. */
  readonly requestId?: string;
  /** Recorded by auth-service in its access log. */
  readonly source?: "gateway" | "ssh" | "external" | "api";
  /** Allow a machine token to ask for a resource decision. Defaults to false. */
  readonly allowMachine?: boolean;
}

type ResourceSource = Partial<OidcUserContext> & {
  readonly auth?: Partial<OidcUserContext>;
  readonly resourceAccess?: AllowedResource;
};

function resourcesOf(appHandle: AppHandle) {
  const manager = appHandle["oidcMachine"];
  if (!manager?.resources?.authorize) {
    throw new OidcResourceError(
      "ERR_RESOURCE_CONFIG",
      "[ioserver-oidc] Register OidcMachineManager before using resource helpers.",
    );
  }
  return manager.resources;
}

function configOf(appHandle: AppHandle): OidcConfig | undefined {
  const manager = appHandle["oidcConfig"];
  if (typeof manager?.getConfig !== "function") return undefined;
  try {
    return manager.getConfig() as OidcConfig;
  } catch {
    return undefined;
  }
}

function isUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function resolveAudience(
  appHandle: AppHandle,
  source: ResourceSource,
  explicit?: string,
): string {
  if (isUrl(explicit)) return explicit;

  const configAudience = configOf(appHandle)?.audience;
  if (isUrl(configAudience)) return configAudience;

  const fromContext = (source.audiences ?? source.auth?.audiences ?? []).find(
    isUrl,
  );
  if (fromContext) return fromContext;

  throw new OidcResourceError(
    "ERR_RESOURCE_CONFIG",
    "[ioserver-oidc] Resource authorization needs an absolute audience URL.",
  );
}

/**
 * Ask auth-service whether the authenticated subject may use a resource.
 *
 * `subjectId`, `clientId` and the audience come from the verified context, never
 * from user input. Every failure — deny, timeout, malformed answer — is a
 * refusal. Only an explicit `decision: "allow"` returns.
 */
export async function requireResourceAccess(
  appHandle: AppHandle,
  source: ResourceSource,
  resourceUri: string,
  options: ResourceAccessOptions = {},
): Promise<AllowedResource> {
  const subjectId = source.sub ?? source.auth?.sub;
  const clientId = source.clientId ?? source.auth?.clientId;
  const isMachine = source.isMachine ?? source.auth?.isMachine === true;

  if (!subjectId || !clientId) {
    throw new OidcResourceError(
      "ERR_RESOURCE_CONFIG",
      "[ioserver-oidc] Resource authorization requires a verified subject and client id.",
    );
  }
  if (isMachine && options.allowMachine !== true) {
    throw new OidcResourceError(
      "ERR_RESOURCE_FORBIDDEN",
      "[ioserver-oidc] Machine tokens are not accepted for resource access.",
    );
  }

  const resources = resourcesOf(appHandle);
  const audience = resolveAudience(appHandle, source, options.audience);

  try {
    const decision = await resources.authorize({
      subjectId,
      clientId,
      resourceUri,
      audience,
      ...(options.requestId ? { requestId: options.requestId } : {}),
      ...(options.source ? { source: options.source } : {}),
    });

    if (decision.decision !== "allow") {
      throw new OidcResourceError(
        "ERR_RESOURCE_FORBIDDEN",
        "[ioserver-oidc] Resource access denied.",
      );
    }

    (source as { resourceAccess?: AllowedResource }).resourceAccess = decision;
    return decision;
  } catch (error) {
    if (error instanceof OidcResourceError) throw error;
    throw new OidcResourceError(
      "ERR_RESOURCE_FORBIDDEN",
      "[ioserver-oidc] Resource access denied.",
      { cause: error },
    );
  }
}

/** List the validated resources a user may use. This is a filter, not an admission. */
export async function listAccessibleResources(
  appHandle: AppHandle,
  subjectId: string,
  options: ListAccessibleOptions = {},
): Promise<AccessibleResource[]> {
  return resourcesOf(appHandle).listAccessible(subjectId, options);
}

/** Report a resource validation outcome (validator applications only). */
export async function validateResource(
  appHandle: AppHandle,
  resourceId: string,
  outcome: ValidationOutcome,
): Promise<ResourceState> {
  return resourcesOf(appHandle).validate(resourceId, outcome);
}

/** Disable a resource whose ownership was lost (validator applications only). */
export async function invalidateResource(
  appHandle: AppHandle,
  resourceId: string,
  reason: string,
): Promise<ResourceState> {
  return resourcesOf(appHandle).invalidate(resourceId, reason);
}

/** Report provider usage for a shared resource. `requestId` makes it idempotent. */
export async function recordResourceUsage(
  appHandle: AppHandle,
  record: UsageRecord,
): Promise<UsageReceipt> {
  return resourcesOf(appHandle).recordUsage(record);
}
