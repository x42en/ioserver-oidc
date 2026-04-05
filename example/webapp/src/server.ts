/**
 * Demo webapp — Express server
 *
 * Routes:
 *   GET  /           → SPA (index.html avec config injectée)
 *   GET  /callback   → idem (gestion OAuth callback côté client)
 *   POST /api/token  → proxy d'échange de code OAuth (client_secret côté serveur)
 *   GET  /api/me     → vérifie le JWT et retourne les claims utilisateur
 *
 * La vérification JWT reproduit fidèlement la logique de ioserver-oidc/src/jwks.ts.
 */
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import * as jose from "jose";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Environnement ─────────────────────────────────────────────────────────────
const AUTH_SERVICE_URL = (process.env["AUTH_SERVICE_URL"] ?? "").replace(
  /\/$/,
  "",
);
const AUTH_SERVICE_INTERNAL_URL = (
  process.env["AUTH_SERVICE_INTERNAL_URL"] ?? AUTH_SERVICE_URL
).replace(/\/$/, "");
const APP_SLUG = process.env["APP_SLUG"] ?? "";
const REDIRECT_URI = process.env["REDIRECT_URI"] ?? "";
const PORT = parseInt(process.env["PORT"] ?? "3000", 10);
const CREDENTIALS_PATH = "/shared/credentials.json";

if (!AUTH_SERVICE_URL || !APP_SLUG || !REDIRECT_URI) {
  process.stderr.write(
    "Vars obligatoires manquantes : AUTH_SERVICE_URL, APP_SLUG, REDIRECT_URI\n",
  );
  process.exit(1);
}

// ── Credentials OAuth ─────────────────────────────────────────────────────────
interface Credentials {
  clientId: string;
  clientSecret: string;
}

function loadCredentials(): Credentials {
  try {
    return JSON.parse(
      fs.readFileSync(CREDENTIALS_PATH, "utf-8"),
    ) as Credentials;
  } catch {
    process.stderr.write(
      `Impossible de lire les credentials depuis ${CREDENTIALS_PATH}.\n` +
        'Vérifiez que le service "setup" s\'est bien exécuté avant la webapp.\n',
    );
    process.exit(1);
  }
}

const credentials = loadCredentials();

// ── Vérification JWT (miroir de ioserver-oidc/src/jwks.ts) ───────────────────
type JwksKeySet = ReturnType<typeof jose.createRemoteJWKSet>;
const jwksCache = new Map<string, JwksKeySet>();

function getJwks(): JwksKeySet {
  const jwksUri = `${AUTH_SERVICE_INTERNAL_URL}/api/auth/jwks`;
  if (!jwksCache.has(jwksUri)) {
    jwksCache.set(jwksUri, jose.createRemoteJWKSet(new URL(jwksUri)));
  }
  return jwksCache.get(jwksUri)!;
}

async function verifyToken(token: string): Promise<Record<string, unknown>> {
  const { payload } = await jose.jwtVerify(token, getJwks(), {
    issuer: AUTH_SERVICE_URL, // = BETTER_AUTH_URL de auth-service
    audience: APP_SLUG, // = client_id OAuth (slug)
  });
  return payload as Record<string, unknown>;
}

// ── Application Express ───────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Injecte la config runtime dans le template HTML
function serveIndex(res: express.Response): void {
  const template = fs.readFileSync(
    path.join(__dirname, "../public/index.html"),
    "utf-8",
  );
  const config = JSON.stringify({
    authServiceUrl: AUTH_SERVICE_URL,
    appSlug: APP_SLUG,
    redirectUri: REDIRECT_URI,
  });
  const html = template.replace(
    "<!-- CONFIG_PLACEHOLDER -->",
    `<script>window.__CONFIG__ = ${config};</script>`,
  );
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
}

// SPA — route principale et callback OAuth
app.get("/", (_req, res) => serveIndex(res));
app.get("/callback", (_req, res) => serveIndex(res));

// Proxy échange de code — le client_secret ne quitte jamais le serveur
app.post("/api/token", async (req, res) => {
  const { code, code_verifier, redirect_uri } = req.body as {
    code?: string;
    code_verifier?: string;
    redirect_uri?: string;
  };

  if (!code || !code_verifier || !redirect_uri) {
    res.status(400).json({
      error: "Champs requis manquants : code, code_verifier, redirect_uri",
    });
    return;
  }

  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier,
    redirect_uri,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  });

  try {
    const tokenRes = await fetch(
      `${AUTH_SERVICE_INTERNAL_URL}/api/auth/oauth2/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      },
    );
    const data = (await tokenRes.json()) as Record<string, unknown>;
    res.status(tokenRes.status).json(data);
  } catch (err) {
    console.error("Erreur échange de token :", err);
    res.status(502).json({ error: "Token exchange failed" });
  }
});

// Refresh token — échange un refresh_token contre de nouveaux tokens
// Le client_secret ne quitte jamais le serveur
app.post("/api/refresh", async (req, res) => {
  const { refresh_token } = req.body as { refresh_token?: string };
  if (!refresh_token) {
    res.status(400).json({ error: "refresh_token manquant" });
    return;
  }

  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  });

  try {
    const tokenRes = await fetch(
      `${AUTH_SERVICE_INTERNAL_URL}/api/auth/oauth2/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      },
    );
    const data = (await tokenRes.json()) as Record<string, unknown>;
    res.status(tokenRes.status).json(data);
  } catch (err) {
    console.error("Erreur refresh token :", err);
    res.status(502).json({ error: "Token refresh failed" });
  }
});

// Profil — vérifie le JWT et retourne les claims OIDC
app.get("/api/me", async (req, res) => {
  const authorization = req.headers["authorization"];
  if (
    typeof authorization !== "string" ||
    !authorization.startsWith("Bearer ")
  ) {
    res.status(401).json({ error: "En-tête Authorization Bearer manquant" });
    return;
  }

  const token = authorization.slice(7);
  try {
    const payload = await verifyToken(token);
    res.json({
      sub: payload["sub"] as string,
      email: (payload["email"] as string | null | undefined) ?? null,
      name: (payload["name"] as string | null | undefined) ?? null,
      roles: Array.isArray(payload["roles"])
        ? (payload["roles"] as string[])
        : [],
      permissions: Array.isArray(payload["permissions"])
        ? (payload["permissions"] as string[])
        : [],
      features:
        typeof payload["features"] === "object" && payload["features"] !== null
          ? (payload["features"] as Record<string, unknown>)
          : {},
    });
  } catch {
    res.status(401).json({ error: "Token invalide ou expiré" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Demo webapp démarrée sur le port ${PORT}`);
});
