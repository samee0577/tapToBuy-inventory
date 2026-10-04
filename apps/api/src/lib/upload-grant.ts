import { SignJWT, jwtVerify } from 'jose';

import { sessionEnv } from '../config/env.js';
import { logger } from './logger.js';

const ISSUER = 'inventory-api';
const AUDIENCE = 'upload-grant';
const ALGORITHM = 'HS256';

/** Long enough to photograph and upload a product on a phone, not much more. */
export const UPLOAD_GRANT_TTL_SECONDS = 15 * 60;

export interface UploadGrant {
  publicId: string;
  userId: string;
}

function signingKey(): Uint8Array {
  return new TextEncoder().encode(sessionEnv().SESSION_SECRET);
}

/**
 * A short-lived token proving this API authorised a specific upload.
 *
 * Without it, `POST /uploads/complete` would accept any public_id and a signed-in
 * user could attach somebody else's image to a product. The token binds the
 * public_id that was issued to the user who requested it, and the verification
 * step then compares the two.
 */
export async function issueUploadGrant(grant: UploadGrant): Promise<string> {
  return new SignJWT({ publicId: grant.publicId })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(grant.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${UPLOAD_GRANT_TTL_SECONDS}s`)
    .sign(signingKey());
}

/** Returns the grant's claims, or null if the token is absent, forged or expired. */
export async function verifyUploadGrant(token: string): Promise<UploadGrant | null> {
  try {
    const { payload } = await jwtVerify(token, signingKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: [ALGORITHM],
    });

    if (typeof payload.sub !== 'string' || typeof payload.publicId !== 'string') return null;

    return { userId: payload.sub, publicId: payload.publicId };
  } catch {
    logger.warn('rejected an invalid upload grant');
    return null;
  }
}
