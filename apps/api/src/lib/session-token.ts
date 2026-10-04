import { SignJWT, jwtVerify } from 'jose';

import type { UserRole } from '@inventory/shared';

import { sessionEnv } from '../config/env.js';

const ISSUER = 'inventory-api';
const AUDIENCE = 'inventory-web';
const ALGORITHM = 'HS256';

export interface SessionClaims {
  userId: string;
  role: UserRole;
  name: string;
}

function signingKey(): Uint8Array {
  // Validates length >= 32 as a side effect of calling sessionEnv().
  return new TextEncoder().encode(sessionEnv().SESSION_SECRET);
}

/**
 * The session is a stateless signed token rather than a row in a sessions table.
 * That is what lets the API run on serverless with no shared memory and no sticky
 * sessions. The trade-off is that revoking access is handled by re-checking the
 * user record on every request (see requireAuth) rather than by deleting a row.
 *
 * The role claim is a convenience for logging only. Authorisation always reads
 * the live role from the database, so a demotion takes effect on the next
 * request instead of when the token happens to expire.
 */
export async function signSessionToken(claims: SessionClaims): Promise<string> {
  const { SESSION_TTL_SECONDS } = sessionEnv();

  return new SignJWT({ role: claims.role, name: claims.name })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(signingKey());
}

export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, signingKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      // Pinned so an attacker cannot present an alg=none token or downgrade to a
      // weaker algorithm.
      algorithms: [ALGORITHM],
    });

    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
    if (payload.role !== 'ADMIN' && payload.role !== 'STAFF') return null;
    if (typeof payload.name !== 'string') return null;

    return { userId: payload.sub, role: payload.role, name: payload.name };
  } catch {
    return null;
  }
}

/**
 * Short-lived signed value used to tie an OAuth callback to the browser that
 * started it. This is the CSRF defence for the redirect-based login flow, which
 * cannot rely on a custom header.
 */
export async function signOAuthState(nonce: string): Promise<string> {
  return new SignJWT({ nonce })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuer(ISSUER)
    .setAudience('oauth-state')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(signingKey());
}

export async function verifyOAuthState(state: string, expectedNonce: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(state, signingKey(), {
      issuer: ISSUER,
      audience: 'oauth-state',
      algorithms: [ALGORITHM],
    });

    return payload.nonce === expectedNonce;
  } catch {
    return false;
  }
}
