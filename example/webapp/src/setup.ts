/**
 * Script de provisioning OAuth — s'exécute une seule fois au démarrage.
 *
 * 1. Attend que auth-service soit prêt (GET /health)
 * 2. Se connecte en tant qu'administrateur
 * 3. Crée l'application OAuth avec les scopes requis
 *    → si l'app existe déjà (409), fait tourner le secret via rotate-secret
 * 4. Écrit { clientId, clientSecret } dans /shared/credentials.json
 *
 * Note : auth-service accorde automatiquement l'accès à l'app à tous les
 * utilisateurs "superadmin" existants lors de la création.
 */
import fs from "fs";

const AUTH_INTERNAL = (process.env["AUTH_SERVICE_INTERNAL_URL"] ?? "").replace(
  /\/$/,
  "",
);
const ADMIN_EMAIL = process.env["ADMIN_EMAIL"] ?? "";
const ADMIN_PASSWORD = process.env["ADMIN_PASSWORD"] ?? "";
const APP_SLUG = process.env["APP_SLUG"] ?? "";
const REDIRECT_URI = process.env["REDIRECT_URI"] ?? "";
const CREDENTIALS_PATH = "/shared/credentials.json";

if (
  !AUTH_INTERNAL ||
  !ADMIN_EMAIL ||
  !ADMIN_PASSWORD ||
  !APP_SLUG ||
  !REDIRECT_URI
) {
  process.stderr.write(
    "Vars obligatoires manquantes : AUTH_SERVICE_INTERNAL_URL, ADMIN_EMAIL, " +
      "ADMIN_PASSWORD, APP_SLUG, REDIRECT_URI\n",
  );
  process.exit(1);
}

// BetterAuth exige un en-tête Origin correspondant à un trustedOrigin.
// On le dérive de REDIRECT_URI (ex: http://app.demo.lan/callback → http://app.demo.lan).
const APP_ORIGIN = new URL(REDIRECT_URI).origin;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(): Promise<void> {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      const res = await fetch(`${AUTH_INTERNAL}/health`);
      if (res.ok) {
        console.log("auth-service est prêt.");
        return;
      }
    } catch {
      // pas encore disponible
    }
    console.log(`En attente de auth-service… (${attempt}/30)`);
    await delay(3000);
  }
  throw new Error(
    "auth-service n'est pas devenu disponible après 90 secondes.",
  );
}

interface SignInResponse {
  user: { id: string };
  token: string;
}

// BetterAuth utilise un cookie signé pour les sessions — bearer token non supporté
// nativement sans le plugin bearerAuth. On capture le Set-Cookie du sign-in et on
// le renvoie comme Cookie dans les appels admin.
async function signIn(): Promise<string> {
  const res = await fetch(`${AUTH_INTERNAL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: APP_ORIGIN,
    },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Connexion admin échouée (${res.status}) : ${body}`);
  }
  // Extraire les cookies de session depuis Set-Cookie
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("Aucun cookie de session reçu après le sign-in.");
  }
  // Reconstituer la valeur Cookie à partir de toutes les directives Set-Cookie :
  // garder uniquement la partie nom=valeur (avant le premier ;) de chaque cookie.
  const cookieHeader = setCookie
    .split(/,(?=[^ ])/)
    .map((c) => c.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
  return cookieHeader;
}

interface CreateAppResponse {
  application: { id: string };
  clientId: string;
  clientSecret: string;
}

interface ListAppsResponse {
  applications: Array<{ id: string; slug: string }>;
}

interface RotateSecretResponse {
  clientSecret: string;
}

async function provisionApp(cookie: string): Promise<string> {
  const authHeaders = {
    "Content-Type": "application/json",
    Cookie: cookie,
    Origin: APP_ORIGIN,
  };

  // Tentative de création
  const createRes = await fetch(`${AUTH_INTERNAL}/api/admin/applications`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      name: "OIDC Demo App",
      slug: APP_SLUG,
      redirectUris: [REDIRECT_URI],
      allowedScopes: [
        "openid",
        "profile",
        "email",
        "roles",
        "permissions",
        "features",
      ],
      skipConsent: true,
    }),
  });

  if (createRes.status === 201) {
    const created = (await createRes.json()) as CreateAppResponse;
    console.log("Application OAuth créée avec succès.");
    return created.clientSecret;
  }

  if (createRes.status === 409) {
    // L'app existe déjà — rotation du secret pour obtenir un secret frais
    console.log("L'application existe déjà — rotation du client_secret…");

    const listRes = await fetch(`${AUTH_INTERNAL}/api/admin/applications`, {
      headers: { Cookie: cookie, Origin: APP_ORIGIN },
    });
    if (!listRes.ok) {
      throw new Error(
        `Impossible de lister les applications : ${listRes.status}`,
      );
    }
    const { applications } = (await listRes.json()) as ListAppsResponse;
    const app = applications.find((a) => a.slug === APP_SLUG);
    if (!app) {
      throw new Error(
        `Application avec le slug "${APP_SLUG}" introuvable dans la liste.`,
      );
    }

    const rotateRes = await fetch(
      `${AUTH_INTERNAL}/api/admin/applications/${app.id}/rotate-secret`,
      { method: "POST", headers: { Cookie: cookie, Origin: APP_ORIGIN } },
    );
    if (!rotateRes.ok) {
      throw new Error(`Rotation du secret échouée : ${rotateRes.status}`);
    }
    const { clientSecret } = (await rotateRes.json()) as RotateSecretResponse;
    console.log("Secret client renouvelé avec succès.");
    return clientSecret;
  }

  const body = await createRes.text();
  throw new Error(
    `Réponse inattendue lors de la création de l'app : ${createRes.status} ${body}`,
  );
}

async function main(): Promise<void> {
  await waitForHealth();

  console.log("Connexion en tant qu'administrateur…");
  const token = await signIn();

  console.log("Provisioning de l'application OAuth…");
  const clientSecret = await provisionApp(token);

  fs.mkdirSync("/shared", { recursive: true });
  fs.writeFileSync(
    CREDENTIALS_PATH,
    JSON.stringify({ clientId: APP_SLUG, clientSecret }),
  );

  console.log("Setup terminé. Credentials enregistrés dans", CREDENTIALS_PATH);
}

main().catch((err: unknown) => {
  console.error("Échec du setup :", err instanceof Error ? err.message : err);
  process.exit(1);
});
