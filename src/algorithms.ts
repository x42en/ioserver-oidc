/**
 * JWS algorithms accepted for access-token verification.
 * Symmetric (`HS*`) and unsecured (`none`) algorithms are never accepted:
 * a public JWKS is an asymmetric trust anchor, and a shared secret would
 * make every verifier a potential signer.
 */
export const ASYMMETRIC_ALGORITHMS = [
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA",
] as const;

export type AsymmetricAlgorithm = (typeof ASYMMETRIC_ALGORITHMS)[number];

export function isAsymmetricAlgorithm(
  value: string,
): value is AsymmetricAlgorithm {
  return (ASYMMETRIC_ALGORITHMS as readonly string[]).includes(value);
}
