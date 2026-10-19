import { signJwt, verifyJwt } from './jwt.js';
import { logger } from './logger.js';

const UPLOAD_GRANT_AUDIENCE = 'upload-grant';

/** Long enough to photograph and upload a product on a phone, not much more. */
export const UPLOAD_GRANT_TTL_SECONDS = 15 * 60;

export interface UploadGrant {
  publicId: string;
  userId: string;
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
  return signJwt(
    UPLOAD_GRANT_AUDIENCE,
    { sub: grant.userId, publicId: grant.publicId },
    UPLOAD_GRANT_TTL_SECONDS,
  );
}

/** Returns the grant's claims, or null if the token is absent, forged or expired. */
export async function verifyUploadGrant(token: string): Promise<UploadGrant | null> {
  const payload = await verifyJwt(token, UPLOAD_GRANT_AUDIENCE);
  if (payload === null) {
    logger.warn('rejected an invalid upload grant');
    return null;
  }

  const { sub, publicId } = payload;
  if (typeof sub !== 'string' || typeof publicId !== 'string') return null;

  return { userId: sub, publicId };
}
