# OIDC Demo — exemple `ioserver-oidc`

Stack d'exemple minimaliste pour tester le flux OAuth 2.0 + PKCE complet avec
[auth-service](https://github.com/circle-rd/auth-service) derrière Traefik.

## Architecture

```
Browser
  ├─→ http://auth.<DOMAIN>  →  Traefik  →  auth-service  (OIDC, pages login/inscription)
  └─→ http://app.<DOMAIN>   →  Traefik  →  webapp        (page profil protégée par JWT)
                                               └─→ auth-service:3001  (JWKS + échange token)
Machine hôte
  └─→ DNS pointé vers HOST_IP  →  dns-resolver  (CoreDNS wildcard *.DOMAIN → HOST_IP)
```

### Services

| Service        | Image                                   | Rôle                                                                  |
| -------------- | --------------------------------------- | --------------------------------------------------------------------- |
| `traefik`      | `traefik:v3`                            | Reverse-proxy HTTP, routage par `Host()`                              |
| `dns`          | `ghcr.io/circle-rd/dns-resolver:latest` | DNS wildcard `*.DOMAIN → HOST_IP` + résolution des noms de conteneurs |
| `postgres`     | `postgres:16-alpine`                    | Base de données d'auth-service                                        |
| `auth-service` | `ghcr.io/circle-rd/auth-service:latest` | Serveur OIDC/OAuth2 (BetterAuth)                                      |
| `setup`        | _(image webapp)_                        | Provisionne l'application OAuth au premier démarrage                  |
| `webapp`       | _(build local)_                         | SPA Express — démontre la vérification JWT de `ioserver-oidc`         |

## Prérequis

- **Docker Engine** ≥ 24 et **Docker Compose CLI** ≥ v2.20
- Port **80** libre sur la machine hôte (Traefik)
- Port **53** UDP/TCP libre sur `HOST_IP` (DNS resolver)
- Aucun autre listener sur le port 53 de `HOST_IP` (voir notes DNS ci-dessous)

## Démarrage rapide

### 1. Configurer l'environnement

```bash
cd ioserver-oidc/example
cp .env.example .env
```

Éditer `.env` et renseigner les variables :

| Variable             | Description                                      | Exemple                   |
| -------------------- | ------------------------------------------------ | ------------------------- |
| `HOST_IP`            | IP LAN de la machine hôte                        | `192.168.1.100`           |
| `DOMAIN`             | TLD local (**évitez `.local`**, réservé mDNS)    | `demo.test`               |
| `ADMIN_EMAIL`        | Email du compte superadmin bootstrap             | `admin@demo.test`         |
| `ADMIN_PASSWORD`     | Mot de passe (min. 8 caractères)                 | `Admin1234!`              |
| `BETTER_AUTH_SECRET` | Clé secrète aléatoire (≥ 32 octets)              | `openssl rand -base64 32` |
| `POSTGRES_PASSWORD`  | Mot de passe PostgreSQL                          | `pgpassword`              |
| `APP_SLUG`           | Identifiant de l'application OAuth (`client_id`) | `oidc-demo`               |

**Trouver votre `HOST_IP` :**

```bash
# Linux
ip route get 1.1.1.1 | awk '{print $7}' | head -1

# macOS
ipconfig getifaddr en0
```

### 2. Démarrer la stack

```bash
docker compose pull && docker compose build && docker compose up -d
```

Au premier démarrage, le service `setup` :

1. Attend que `auth-service` soit disponible
2. Crée automatiquement l'application OAuth (`APP_SLUG`) avec les scopes nécessaires
3. Stocke les credentials dans un volume Docker partagé avec la webapp

Les conteneurs démarrent dans l'ordre grâce aux conditions `service_healthy` et
`service_completed_successfully` de Docker Compose.

### 3. Configurer le DNS sur votre machine

Le navigateur doit pouvoir résoudre `*.DOMAIN` vers `HOST_IP`.
Configurez votre DNS pour que les requêtes vers `DOMAIN` soient transmises au dns-resolver.

**Linux (systemd-resolved)**

```bash
# Remplacer eth0 par votre interface réseau (ip link)
sudo resolvectl dns eth0 <HOST_IP>
sudo resolvectl domain eth0 "~demo.test"
```

Ou, pour une configuration temporaire :

```bash
# Ajouter en tête de /etc/resolv.conf
nameserver <HOST_IP>
```

> ⚠️ Sur Linux, systemd-resolved intercepte `.local` via mDNS.
> Utilisez un TLD différent (`.test`, `.internal`, `.demo`…).

**macOS**

```bash
sudo mkdir -p /etc/resolver
echo "nameserver <HOST_IP>" | sudo tee /etc/resolver/demo.test
```

**Windows**

Paramètres réseau → Adaptateur → Propriétés IPv4 → DNS préféré : `<HOST_IP>`.

### 4. Tester

| URL                     | Description                           |
| ----------------------- | ------------------------------------- |
| `http://app.<DOMAIN>`   | Webapp demo (page login / profil)     |
| `http://auth.<DOMAIN>`  | Auth-service (inscription, connexion) |
| `http://localhost:8080` | Dashboard Traefik                     |

**Compte de test :** connectez-vous avec `ADMIN_EMAIL` / `ADMIN_PASSWORD` définis dans `.env`.
Ce compte est automatiquement provisionné comme superadmin de l'application OAuth.

## Ce que la démo illustre

1. **PKCE flow complet** — génération de `code_verifier` / `code_challenge` dans le navigateur,
   redirection vers auth-service, retour sur `/callback` avec le code d'autorisation.

2. **Proxy d'échange de token** — `POST /api/token` sur la webapp transmet le code à
   auth-service avec le `client_secret` (qui ne quitte jamais le serveur).

3. **Vérification JWT via JWKS** — `GET /api/me` vérifie la signature du `access_token`
   en récupérant les clés publiques depuis `auth-service/api/auth/jwks`.
   Cette logique est un miroir fidèle de `OidcHttpMiddleware` de `ioserver-oidc`.

4. **Claims OIDC** — la page de profil affiche `sub`, `email`, `name`, `roles`,
   `permissions` et `features` extraits du JWT.

## Nettoyage

```bash
# Arrêter sans supprimer les données
docker compose down

# Arrêter et supprimer tous les volumes (base de données + credentials OAuth)
docker compose down -v
```

---

> Les artefacts générés (`webapp/node_modules/`, `webapp/dist/`, `.env`) sont
> ignorés par le `.gitignore` de ce répertoire et par celui de la racine du projet.
