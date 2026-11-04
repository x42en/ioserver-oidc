import { createAuthClient } from "@circle-rd/auth-ai";
import type { AuthClient } from "@circle-rd/auth-ai";
import {
  MemoryReplayStore,
  createBackchannelLogoutHandler,
} from "@circle-rd/auth-ai/server";
import type {
  BackchannelLogoutEvent,
  ReplayStore,
} from "@circle-rd/auth-ai/server";
import type { OidcConfig } from "./types.js";

interface FastifyRequestLike {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: unknown;
}

interface FastifyReplyLike {
  code(statusCode: number): FastifyReplyLike;
  header(name: string, value: string): FastifyReplyLike;
  send(payload?: unknown): void;
}

interface FastifyLike {
  post(
    path: string,
    options: { bodyLimit: number },
    handler: (
      request: FastifyRequestLike,
      reply: FastifyReplyLike,
    ) => Promise<void>,
  ): unknown;
  hasContentTypeParser?(contentType: string): boolean;
  addContentTypeParser?(
    contentType: string,
    options: { parseAs: "string" },
    parser: (
      request: unknown,
      body: string,
      done: (error: Error | null, body?: string) => void,
    ) => void,
  ): unknown;
}

export interface RegisterBackchannelLogoutOptions {
  /** Resolved OIDC configuration. Required unless `auth` is provided. */
  readonly config?: OidcConfig;
  /** Reuse an existing auth-service SDK client instead of building one. */
  readonly auth?: AuthClient;
  /** Route path. Default: `/auth/backchannel-logout`. */
  readonly path?: string;
  /** Origin used to rebuild the callback URL. Defaults to the request Host. */
  readonly origin?: string;
  /** Redirect URI registered in auth-service. Only used to build the verifier. */
  readonly redirectUri?: string;
  /** Called for every accepted logout token. */
  readonly onLogout: (event: BackchannelLogoutEvent) => Promise<void> | void;
  readonly replayStore?: ReplayStore;
  readonly onError?: (error: unknown) => void;
}

const DEFAULT_PATH = "/auth/backchannel-logout";
const MAX_BODY_BYTES = 16_384;

function toWebRequest(
  request: FastifyRequestLike,
  origin: string,
): Request | null {
  const contentType = request.headers["content-type"] ?? "";
  const mediaType = Array.isArray(contentType)
    ? contentType.join(",")
    : contentType;
  if (
    !mediaType.toLowerCase().startsWith("application/x-www-form-urlencoded")
  ) {
    return null;
  }

  let body = "";
  if (typeof request.body === "string") {
    body = request.body;
  } else if (Buffer.isBuffer(request.body)) {
    body = request.body.toString("utf8");
  } else if (request.body && typeof request.body === "object") {
    const form = new URLSearchParams();
    for (const [name, value] of Object.entries(
      request.body as Record<string, unknown>,
    )) {
      if (typeof value === "string") form.set(name, value);
    }
    body = form.toString();
  }
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) return null;

  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) {
      headers.set(name, Array.isArray(value) ? value.join(",") : value);
    }
  }
  headers.set("content-type", "application/x-www-form-urlencoded");

  return new Request(new URL(request.url, origin), {
    method: "POST",
    headers,
    body,
  });
}

/**
 * Register the OIDC Back-Channel Logout 1.0 endpoint on an IOServer Fastify
 * instance. Mount it outside any session or CSRF middleware:
 *
 * ```ts
 * registerBackchannelLogout(server.getApp(), {
 *   config: server.getManager("oidcConfig").getConfig(),
 *   onLogout: ({ sid, sub }) => sessions.endBySid(sid, sub),
 * });
 * ```
 *
 * The handler verifies the logout token with the auth-ai SDK (signature,
 * `typ`, audience, event, lifetime and replay) and returns `204` on success.
 * Responses never carry error detail.
 */
export function registerBackchannelLogout(
  app: FastifyLike,
  options: RegisterBackchannelLogoutOptions,
): void {
  const auth = options.auth ?? buildAuthClient(options);
  const contentType = "application/x-www-form-urlencoded";
  if (
    app.hasContentTypeParser &&
    app.addContentTypeParser &&
    !app.hasContentTypeParser(contentType)
  ) {
    app.addContentTypeParser(
      contentType,
      { parseAs: "string" },
      (_request, body, done) => done(null, body),
    );
  }
  const handler = createBackchannelLogoutHandler({
    auth,
    onLogout: options.onLogout,
    replayStore: options.replayStore ?? new MemoryReplayStore(),
    ...(options.onError ? { onError: options.onError } : {}),
  });

  app.post(
    options.path ?? DEFAULT_PATH,
    { bodyLimit: MAX_BODY_BYTES },
    async (request, reply) => {
      const origin =
        options.origin ??
        `https://${String(request.headers["host"] ?? "localhost")}`;
      let webRequest: Request | null;
      try {
        webRequest = toWebRequest(request, origin);
      } catch {
        webRequest = null;
      }
      if (!webRequest) {
        reply
          .code(400)
          .header("cache-control", "no-store")
          .send({ error: "invalid_request" });
        return;
      }

      const response = await handler(webRequest);
      reply.code(response.status);
      response.headers.forEach((value, name) => {
        reply.header(name, value);
      });
      const text = await response.text();
      reply.send(text.length > 0 ? text : null);
    },
  );
}

function buildAuthClient(
  options: RegisterBackchannelLogoutOptions,
): AuthClient {
  const config = options.config;
  if (!config) {
    throw new Error(
      "[ioserver-oidc] registerBackchannelLogout requires a config or an auth client.",
    );
  }
  const issuer = (config.issuer ?? config.authServiceUrl).replace(/\/$/, "");
  if (!config.appSlug) {
    throw new Error(
      "[ioserver-oidc] appSlug (client id) is required for back-channel logout.",
    );
  }
  return createAuthClient({
    issuer,
    clientId: config.appSlug,
    redirectUri: options.redirectUri ?? `${issuer}/__ioserver_oidc_callback`,
  });
}
