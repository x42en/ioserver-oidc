/**
 * Machine API manager for auth-service resource sharing, billing and
 * consumption.
 *
 * @version 0.4.0
 * @since 0.4.0
 */

import { BaseManager } from "ioserver";
import type { AppHandle } from "ioserver";
import { createAuthClient } from "@circle-rd/auth-ai";
import {
  createMachineApi,
  type MachineApi,
  type ResourcesApi,
} from "@circle-rd/auth-ai/server";
import { isInsecureHttpAllowed, assertHttpUrl, joinUrl } from "./url.js";
import type { OidcConfig } from "./types.js";

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function requireConfig(appHandle: AppHandle): OidcConfig {
  const manager = appHandle["oidcConfig"];
  if (typeof manager?.getConfig !== "function") {
    throw new Error(
      "[OidcMachineManager] OidcConfigManager must be registered before OidcMachineManager.",
    );
  }
  return manager.getConfig() as OidcConfig;
}

/**
 * Exposes `machine.resources`, `machine.billing` and `machine.consumption`
 * through `appHandle.oidcMachine`.
 *
 * A confidential auth-service client is required. The secret is read from
 * `AUTH_SERVICE_CLIENT_SECRET` (or `OIDC_CLIENT_SECRET`) and is never stored in
 * `OidcConfig`, logged, or copied onto requests.
 */
export class OidcMachineManager extends BaseManager {
  readonly api: MachineApi;
  readonly resources: ResourcesApi;
  readonly billing: MachineApi["billing"];
  readonly consumption: MachineApi["consumption"];

  constructor(appHandle: AppHandle) {
    super(appHandle);

    const config = requireConfig(appHandle);
    if (config.provider === "oidc") {
      throw new Error(
        "[OidcMachineManager] The machine API is only available for auth-service.",
      );
    }
    if (!config.appSlug) {
      throw new Error(
        "[OidcMachineManager] appSlug (client id) is required for the machine API.",
      );
    }

    const clientSecret =
      env("AUTH_SERVICE_CLIENT_SECRET") ?? env("OIDC_CLIENT_SECRET");
    if (!clientSecret) {
      throw new Error(
        "[OidcMachineManager] AUTH_SERVICE_CLIENT_SECRET is required for the machine API.",
      );
    }

    const issuer = assertHttpUrl(
      config.issuer ?? config.authServiceUrl,
      "issuer",
      isInsecureHttpAllowed(),
    );
    const redirectUri =
      env("AUTH_SERVICE_MACHINE_REDIRECT_URI") ??
      joinUrl(issuer, "__ioserver_oidc_machine");

    const authMethod = env("AUTH_SERVICE_TOKEN_ENDPOINT_AUTH_METHOD");
    if (
      authMethod !== undefined &&
      authMethod !== "client_secret_basic" &&
      authMethod !== "client_secret_post"
    ) {
      throw new Error(
        "[OidcMachineManager] AUTH_SERVICE_TOKEN_ENDPOINT_AUTH_METHOD must be client_secret_basic or client_secret_post.",
      );
    }
    const auth = createAuthClient({
      issuer,
      clientId: config.appSlug,
      clientSecret,
      redirectUri,
      ...(authMethod === "client_secret_post" ||
      authMethod === "client_secret_basic"
        ? { tokenEndpointAuthMethod: authMethod }
        : {}),
    });

    this.api = createMachineApi(auth);
    this.resources = this.api.resources;
    this.billing = this.api.billing;
    this.consumption = this.api.consumption;
  }

  async start(): Promise<void> {
    this.appHandle.log(
      6,
      "[OidcMachineManager] Machine API initialized (resources, billing, consumption)",
    );
  }
}
