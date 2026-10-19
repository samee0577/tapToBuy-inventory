import { SignJWT, jwtVerify } from 'jose';

import { sessionEnv } from '../config/env.js';

const ISSUER = 'inventory-api';
const ALGORITHM = 'HS256';

function signingKey(): Uint8Array {
  // Validates length >= 32 as a side effect of calling sessionEnv().
  return new TextEncoder().encode(sessionEnv().SESSION_SECRET);
}

/**
 * Signs a JWT for one of the app's audiences. Every token the API issues goes
 * through here, so issuer, algorithm and key handling live in exactly one place.
 */
export async function signJwt(
  audience: string,
  claims: Record<string, unknown>,
  ttlSeconds: number,
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuer(ISSUER)
    .setAudience(audience)
    .setIssuedAt()
    // String form, not a number: jose reads a numeric input as an absolute epoch
    // second, which would stamp every token expired in 1970.
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(signingKey());
}

/**
 * Verifies a JWT against the given audience. Returns the payload, or null when
 * the token is absent, forged, expired or issued for a different audience.
 */
export async function verifyJwt(
  token: string,
  audience: string,
): Promise<Record<string, unknown> | null> {
  try {
    const { payload } = await jwtVerify(token, signingKey(), {
      issuer: ISSUER,
      audience,
      // Pinned so an attacker cannot present an alg=none token or downgrade to a
      // weaker algorithm.
      algorithms: [ALGORITHM],
    });

    return payload;
  } catch {
    return null;
  }
}
