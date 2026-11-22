/**
 * URL validation shared by configuration, wallet, gateway and logout helpers.
 *
 * @version 0.4.0
 * @since 0.3.2
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const TRUTHY = new Set(["1", "true", "yes", "on"]);

function isLoopback(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/**
 * Resolve the insecure-HTTP opt-in from an explicit flag or the environment.
 */
export function isInsecureHttpAllowed(flag?: boolean): boolean {
  if (flag !== undefined) return flag;
  const value = process.env["OIDC_ALLOW_INSECURE_HTTP"];
  return value !== undefined && TRUTHY.has(value.trim().toLowerCase());
}

/**
 * Join a base URL and a path without producing a double slash.
 *
 * Issuers are compared verbatim to the token `iss`, so callers must keep the
 * configured issuer untouched and use this helper only for derived URLs.
 */
export function joinUrl(base: string, pathname: string): string {
  return `${base.replace(/\/+$/, "")}/${pathname.replace(/^\/+/, "")}`;
}

/**
 * Validate an absolute HTTP(S) URL used to reach a trusted service.
 *
 * Plain HTTP is only accepted for loopback hosts, or when the caller explicitly
 * opts into insecure transport for a controlled development environment.
 */
export function assertHttpUrl(
  value: string,
  variable: string,
  allowInsecureHttp = false,
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `[ioserver-oidc] ${variable} must be an absolute URL, got "${value}".`,
    );
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(
      `[ioserver-oidc] ${variable} must use http or https, got "${value}".`,
    );
  }

  if (url.username || url.password) {
    throw new Error(
      `[ioserver-oidc] ${variable} must not contain credentials.`,
    );
  }

  if (
    url.protocol === "http:" &&
    !allowInsecureHttp &&
    !isLoopback(url.hostname)
  ) {
    throw new Error(
      `[ioserver-oidc] ${variable} must use https for non-loopback hosts, got "${value}". Set the insecure-HTTP opt-in only for controlled development environments.`,
    );
  }

  return value;
}
