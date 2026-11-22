import { describe, it, expect } from "vitest";
import {
  buildProtectedResourceMetadata,
  registerProtectedResourceMetadata,
} from "../../src/metadata.js";

const config = {
  authServiceUrl: "https://auth.example.com",
  appSlug: "my-app",
  issuer: "https://auth.example.com",
  audience: "https://api.example.com/gine",
};

describe("protected resource metadata", () => {
  it("builds metadata and the well-known path", () => {
    const { metadata, path } = buildProtectedResourceMetadata(config, {
      scopesSupported: ["gine:read", "gine:write"],
    });

    expect(metadata).toEqual({
      resource: "https://api.example.com/gine",
      authorization_servers: ["https://auth.example.com"],
      bearer_methods_supported: ["header"],
      scopes_supported: ["gine:read", "gine:write"],
    });
    expect(path).toBe("/.well-known/oauth-protected-resource/gine");
  });

  it("supports an explicit resource and rejects a non-URL audience", () => {
    const { metadata } = buildProtectedResourceMetadata(config, {
      resource: "https://other.example.com",
    });
    expect(metadata.resource).toBe("https://other.example.com");

    expect(() =>
      buildProtectedResourceMetadata({ ...config, audience: "my-app" }),
    ).toThrow(/absolute resource audience/);

    expect(() =>
      buildProtectedResourceMetadata({ ...config, audience: undefined }),
    ).toThrow(/absolute resource audience/);
  });

  it("serves metadata with a public cache policy", () => {
    let registeredPath: string | undefined;
    let handler: ((request: unknown, reply: unknown) => void) | undefined;
    const app = {
      get(path: string, fn: (request: unknown, reply: unknown) => void) {
        registeredPath = path;
        handler = fn;
        return app;
      },
    };
    const reply = {
      headers: {} as Record<string, string>,
      body: undefined as unknown,
      header(name: string, value: string) {
        this.headers[name] = value;
        return this;
      },
      send(body: unknown) {
        this.body = body;
      },
    };

    registerProtectedResourceMetadata(app as any, { config });
    handler?.({}, reply);

    expect(registeredPath).toContain("/.well-known/oauth-protected-resource");
    expect(reply.headers["cache-control"]).toBe("public, max-age=3600");
    expect(reply.body).toMatchObject({
      resource: "https://api.example.com/gine",
      authorization_servers: ["https://auth.example.com"],
    });
  });

  it("validates transport security", () => {
    expect(() =>
      buildProtectedResourceMetadata({
        ...config,
        issuer: "http://auth.example.com",
      }),
    ).toThrow(/must use https/);
  });
});
