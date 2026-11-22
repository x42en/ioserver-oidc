/** Stable error codes returned by the OIDC middlewares. */
export type OidcErrorCode =
  | "ERR_AUTH_TOKEN_REQUIRED"
  | "ERR_AUTH_TOKEN_INVALID"
  | "ERR_MACHINE_TOKEN_FORBIDDEN"
  | "ERR_ACCOUNT_DISABLED"
  | "ERR_USER_PROVISION_FAILED"
  | "ERR_OIDC_CONFIG"
  | "ERR_RESOURCE_FORBIDDEN"
  | "ERR_RESOURCE_CONFIG"
  | "ERR_FORBIDDEN";

/**
 * A verification failure with a stable public code.
 *
 * `jose` errors are kept as the underlying cause; this wrapper only adds the
 * code the middleware serialises, so details never leak to the client.
 */
export class OidcTokenError extends Error {
  readonly code: OidcErrorCode;

  constructor(code: OidcErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OidcTokenError";
    this.code = code;
  }
}

/** Resource-sharing admission or configuration failure. */
export class OidcResourceError extends Error {
  readonly code: OidcErrorCode;
  readonly statusCode: number;
  readonly status: number;

  constructor(code: OidcErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OidcResourceError";
    this.code = code;
    this.statusCode = code === "ERR_RESOURCE_FORBIDDEN" ? 403 : 500;
    this.status = this.statusCode;
  }
}
