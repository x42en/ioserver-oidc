/**
 * RFC 9728 protected-resource metadata for auth-service APIs.
 *
 * @version 0.4.0
 * @since 0.4.0
 */

import type { ProtectedResourceMetadata } from "@circle-rd/auth-ai/server";
import { protectedResourceMetadataPath } from "@circle-rd/auth-ai/server";
import { assertHttpUrl, isInsecureHttpAllowed } from "./url.js";
import type { OidcConfig } from "./types.js";

interface FastifyMetadataReply {
  header(name: string, value: string): FastifyMetadataReply;
  send(payload: unknown): unknown;
}

interface FastifyMetadataLike {
  get(
    path: string,
    handler: (request: unknown, reply: FastifyMetadataReply) => void,
  ): unknown;
}

export interface RegisterProtectedResourceMetadataOptions {
  readonly config: OidcConfig;
  /** Resource identifier; defaults to `config.audience`. */
  readonly resource?: string;
  readonly scopesSupported?: readonly string[];
  /** Allow plain HTTP for a controlled non-loopback development service. */
  readonly allowInsecureHttp?: boolean;
}

export function buildProtectedResourceMetadata(
  config: OidcConfig,
  options: Omit<RegisterProtectedResourceMetadataOptions, "config"> = {},
): { metadata: ProtectedResourceMetadata; path: string } {
  const resource = options.resource ?? config.audience;
  if (!resource) {
    throw new Error(
      "[ioserver-oidc] Protected-resource metadata requires an absolute resource audience.",
    );
  }

  const insecure = isInsecureHttpAllowed(options.allowInsecureHttp);
  try {
    assertHttpUrl(resource, "resource", insecure);
  } catch {
    throw new Error(
      "[ioserver-oidc] Protected-resource metadata requires an absolute resource audience.",
    );
  }
  const issuer = assertHttpUrl(
    config.issuer ?? config.authServiceUrl,
    "issuer",
    insecure,
  );

  const metadata: ProtectedResourceMetadata = {
    resource,
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    ...(options.scopesSupported && options.scopesSupported.length > 0
      ? { scopes_supported: options.scopesSupported }
      : {}),
  };

  return {
    metadata,
    path: protectedResourceMetadataPath(resource),
  };
}

/**
 * Serve RFC 9728 metadata at `/.well-known/oauth-protected-resource...`.
 * Call before `server.start()`.
 */
export function registerProtectedResourceMetadata(
  app: FastifyMetadataLike,
  options: RegisterProtectedResourceMetadataOptions,
): void {
  const { metadata, path } = buildProtectedResourceMetadata(
    options.config,
    options,
  );

  app.get(path, (_request, reply) => {
    reply.header("cache-control", "public, max-age=3600").send(metadata);
  });
}
