import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { TextEncoder } from "node:util";
import * as jose from "jose";
import { verifyOidcToken } from "../../src/jwks.js";
import type { OidcConfig } from "../../src/types.js";

// ─────────────────────────────────────────────────────────────────────────────
// This integration test generates a real RSA key pair and serves the JWKS
// endpoint via an in-process HTTP server. Tokens are signed locally and
// verified through the full verifyOidcToken() code path.
// ─────────────────────────────────────────────────────────────────────────────

let server: Server;
let privateKey: jose.KeyLike;
let publicKey: jose.KeyLike;
let jwksPort: number;
let config: OidcConfig;

const ISSUER = "https://auth.test.local";
const APP_SLUG = "test-app";

beforeAll(async () => {
  // Generate RSA-2048 key pair
  const { privateKey: priv, publicKey: pub } = await jose.generateKeyPair("RS256");
  privateKey = priv;
  publicKey = pub;

  // Export public key as JWKS
  const jwk = await jose.exportJWK(publicKey);
  jwk.kid = "test-key-1";
  jwk.use = "sig";
  const jwks = JSON.stringify({ keys: [jwk] });

  // Spin up a minimal HTTP server to serve the JWKS
  server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(jwks);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  jwksPort = (server.address() as { port: number }).port;

  config = {
    authServiceUrl: ISSUER,
    appSlug: APP_SLUG,
    jwksUri: `http://127.0.0.1:${jwksPort}`,
    issuer: ISSUER,
  };
});

afterAll(() => {
  server.close();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function signToken(
  claims: Record<string, unknown>,
  options: { expiresIn?: string; expiresAt?: Date; audience?: string; issuer?: string } = {},
): Promise<string> {
  const builder = new jose.SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
    .setIssuedAt()
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? APP_SLUG);  if (options.expiresAt !== undefined) {
    builder.setExpirationTime(options.expiresAt);
  } else if (options.expiresIn !== undefined) {
    builder.setExpirationTime(options.expiresIn);
  } else {
    builder.setExpirationTime("1h");
  }

  return builder.sign(privateKey);
}

// ─────────────────────────────────────────────────────────────────────────────

describe("verifyOidcToken() — integration (real RSA JWKS)", () => {
  it("verifies a valid token and returns a complete OidcUserContext", async () => {
    const token = await signToken({
      sub: "user-integration-1",
      email: "bob@example.com",
      name: "Bob",
      roles: ["admin", "user"],
      permissions: ["read", "write"],
      features: { maxProjects: 5 },
    });

    const ctx = await verifyOidcToken(token, config);

    expect(ctx.sub).toBe("user-integration-1");
    expect(ctx.userId).toBe("user-integration-1");
    expect(ctx.email).toBe("bob@example.com");
    expect(ctx.name).toBe("Bob");
    expect(ctx.userRole).toBe("admin");
    expect(ctx.roles).toEqual(["admin", "user"]);
    expect(ctx.permissions).toEqual(["read", "write"]);
    expect(ctx.features).toEqual({ maxProjects: 5 });
  });

  it("returns default values for missing optional claims", async () => {
    const token = await signToken({ sub: "user-minimal" });

    const ctx = await verifyOidcToken(token, config);

    expect(ctx.sub).toBe("user-minimal");
    expect(ctx.email).toBeNull();
    expect(ctx.name).toBeNull();
    expect(ctx.userRole).toBe("user");
    expect(ctx.roles).toEqual([]);
    expect(ctx.permissions).toEqual([]);
    expect(ctx.features).toEqual({});
  });

  it("throws on an expired token", async () => {
    // Set expiry to 1 second in the past
    const expiredAt = new Date(Date.now() - 1000);
    const token = await signToken({ sub: "user-1" }, { expiresAt: expiredAt });

    await expect(verifyOidcToken(token, config)).rejects.toThrow();
  });

  it("throws when audience does not match appSlug", async () => {
    const token = await signToken({ sub: "user-1" }, { audience: "wrong-app" });

    await expect(verifyOidcToken(token, config)).rejects.toThrow();
  });

  it("throws when issuer does not match", async () => {
    const token = await signToken(
      { sub: "user-1" },
      { issuer: "https://evil.example.com" },
    );

    await expect(verifyOidcToken(token, config)).rejects.toThrow();
  });

  it("accepts a token whose azp matches appSlug", async () => {
    const token = await signToken({ sub: "user-azp", azp: APP_SLUG });

    const ctx = await verifyOidcToken(token, config);
    expect(ctx.sub).toBe("user-azp");
  });

  it("rejects a cross-app token (azp does not match appSlug)", async () => {
    // Token legitimately minted for another application sharing the same
    // issuer — must NOT be accepted here, even though iss/aud verify.
    const token = await signToken({
      sub: "attacker",
      azp: "another-app",
      roles: ["admin"],
    });

    await expect(verifyOidcToken(token, config)).rejects.toThrow(
      /authorized party/i,
    );
  });

  it("rejects a token signed with a non-allow-listed algorithm (HS256)", async () => {
    // Algorithm-confusion attempt: sign an HS256 token using the issuer's
    // PUBLIC key bytes as the HMAC secret. Must be rejected by the allow-list.
    const pubJwk = await jose.exportJWK(publicKey);
    const secret = new TextEncoder().encode(JSON.stringify(pubJwk));
    const hsToken = await new jose.SignJWT({ sub: "attacker", roles: ["admin"] })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience(APP_SLUG)
      .setExpirationTime("1h")
      .sign(secret);

    await expect(verifyOidcToken(hsToken, config)).rejects.toThrow();
  });

  it("requires an azp claim in resource-audience mode (RFC 8707)", async () => {
    const resourceConfig: OidcConfig = {
      ...config,
      audience: "https://api.test.local",
    };
    // No azp present, aud = resource URL → token cannot be bound to the app.
    const token = await signToken(
      { sub: "user-1", roles: ["admin"] },
      { audience: "https://api.test.local" },
    );

    await expect(verifyOidcToken(token, resourceConfig)).rejects.toThrow(
      /authorized party/i,
    );
  });

  it("accepts a resource-audience token carrying a matching azp", async () => {
    const resourceConfig: OidcConfig = {
      ...config,
      audience: "https://api.test.local",
    };
    const token = await signToken(
      { sub: "user-ok", azp: APP_SLUG },
      { audience: "https://api.test.local" },
    );

    const ctx = await verifyOidcToken(token, resourceConfig);
    expect(ctx.sub).toBe("user-ok");
  });
});
