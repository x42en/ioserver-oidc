/**
 * Signed auth-service resource webhooks for IOServer.
 *
 * @version 0.4.0
 * @since 0.4.0
 */

import {
  MemoryReplayStore,
  verifyResourceEvent,
  type ReplayStore,
  type ResourceEvent,
} from "@circle-rd/auth-ai/server";

interface FastifyWebhookReply {
  code(statusCode: number): FastifyWebhookReply;
  header(name: string, value: string): FastifyWebhookReply;
  send(payload?: unknown): unknown;
}

interface FastifyWebhookScope {
  addContentTypeParser(
    contentType: string,
    options: { parseAs: "buffer" },
    parser: (
      request: unknown,
      body: Buffer,
      done: (error: Error | null, body?: Buffer) => void,
    ) => void,
  ): unknown;
  post(
    path: string,
    options: { bodyLimit: number },
    handler: (
      request: {
        headers: Record<string, string | string[] | undefined>;
        body: unknown;
      },
      reply: FastifyWebhookReply,
    ) => Promise<void>,
  ): unknown;
}

interface FastifyWebhookLike {
  register(
    plugin: (scope: FastifyWebhookScope) => Promise<void> | void,
  ): unknown;
}

export interface RegisterResourceWebhookOptions {
  /** The application's resource webhook secret from auth-service. */
  readonly secret: string;
  /** Route path. Default: `/auth/resource-webhook`. */
  readonly path?: string;
  /** Accepted distance from the delivery timestamp, 300 seconds by default. */
  readonly toleranceSeconds?: number;
  /** Maximum raw body size in bytes. Default: 64 KiB. */
  readonly maxBodyBytes?: number;
  /** Replay store keyed by `eventId`; defaults to an in-process store. */
  readonly replayStore?: ReplayStore;
  readonly onEvent: (event: ResourceEvent) => Promise<void> | void;
  readonly onError?: (error: unknown) => void;
}

const DEFAULT_PATH = "/auth/resource-webhook";
const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

function toBuffer(body: unknown): Buffer | null {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === "string") return Buffer.from(body, "utf8");
  return null;
}

/**
 * Verify and dispatch auth-service resource-sharing webhooks. The route is
 * mounted with an encapsulated JSON parser so other routes keep their normal
 * parsed bodies. Call before `server.start()`.
 */
export function registerResourceWebhook(
  app: FastifyWebhookLike,
  options: RegisterResourceWebhookOptions,
): void {
  if (!options.secret || options.secret.length === 0) {
    throw new Error("[ioserver-oidc] The resource webhook secret is required.");
  }
  if (
    options.toleranceSeconds !== undefined &&
    (!Number.isInteger(options.toleranceSeconds) ||
      options.toleranceSeconds < 0)
  ) {
    throw new Error(
      "[ioserver-oidc] toleranceSeconds must be a non-negative integer.",
    );
  }

  const path = options.path ?? DEFAULT_PATH;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes <= 0) {
    throw new Error("[ioserver-oidc] maxBodyBytes must be a positive integer.");
  }

  const replayStore = options.replayStore ?? new MemoryReplayStore();
  const toleranceSeconds = options.toleranceSeconds ?? 300;

  app.register(async (scope) => {
    scope.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_request, body, done) => done(null, body),
    );

    scope.post(path, { bodyLimit: maxBodyBytes }, async (request, reply) => {
      const raw = toBuffer(request.body);
      if (!raw) {
        reply
          .code(400)
          .header("cache-control", "no-store")
          .send({ error: "invalid_request" });
        return;
      }

      let event: ResourceEvent;
      try {
        event = await verifyResourceEvent(request.headers, raw, {
          secret: options.secret,
          toleranceSeconds,
        });
      } catch (error) {
        options.onError?.(error);
        reply
          .code(400)
          .header("cache-control", "no-store")
          .send({ error: "invalid_request" });
        return;
      }

      const expiresAt = Math.floor(Date.now() / 1000) + toleranceSeconds + 60;
      let firstDelivery: boolean;
      try {
        firstDelivery = await replayStore.claim(event.eventId, expiresAt);
      } catch (error) {
        options.onError?.(error);
        reply
          .code(500)
          .header("cache-control", "no-store")
          .send({ error: "server_error" });
        return;
      }
      if (!firstDelivery) {
        reply.code(204).header("cache-control", "no-store").send();
        return;
      }

      try {
        await options.onEvent(event);
      } catch (error) {
        options.onError?.(error);
        reply
          .code(500)
          .header("cache-control", "no-store")
          .send({ error: "server_error" });
        return;
      }

      reply.code(204).header("cache-control", "no-store").send();
    });
  });
}
