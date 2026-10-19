import type { UserRole } from '@inventory/shared';

import { sessionEnv } from '../config/env.js';
import { signJwt, verifyJwt } from './jwt.js';

const SESSION_AUDIENCE = 'inventory-web';
const OAUTH_STATE_AUDIENCE = 'oauth-state';
const OAUTH_STATE_TTL_SECONDS = 10 * 60;

export interface SessionClaims {
  userId: string;
  role: UserRole;
  name: string;
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

  return signJwt(
    SESSION_AUDIENCE,
    { sub: claims.userId, role: claims.role, name: claims.name },
    SESSION_TTL_SECONDS,
  );
}

export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  const payload = await verifyJwt(token, SESSION_AUDIENCE);
  if (payload === null) return null;

  const { sub, role, name } = payload;
  if (typeof sub !== 'string' || sub.length === 0) return null;
  if (role !== 'ADMIN' && role !== 'STAFF') return null;
  if (typeof name !== 'string') return null;

  return { userId: sub, role, name };
}

/**
 * Short-lived signed value used to tie an OAuth callback to the browser that
 * started it. This is the CSRF defence for the redirect-based login flow, which
 * cannot rely on a custom header.
 */
export async function signOAuthState(nonce: string): Promise<string> {
  return signJwt(OAUTH_STATE_AUDIENCE, { nonce }, OAUTH_STATE_TTL_SECONDS);
}

export async function verifyOAuthState(state: string, expectedNonce: string): Promise<boolean> {
  const payload = await verifyJwt(state, OAUTH_STATE_AUDIENCE);
  return payload !== null && payload.nonce === expectedNonce;
}
