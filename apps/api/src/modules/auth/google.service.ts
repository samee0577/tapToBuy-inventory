import { randomBytes } from 'node:crypto';

import { OAuth2Client, type TokenPayload } from 'google-auth-library';

import { ApiErrorCode } from '@inventory/shared';

import { googleEnv } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { signOAuthState, verifyOAuthState } from '../../lib/session-token.js';

const SCOPES = ['openid', 'email', 'profile'];

export const GOOGLE_CALLBACK_PATH = '/api/auth/google/callback';

export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
}

function client(redirectUri: string): OAuth2Client {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = googleEnv();

  return new OAuth2Client({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri,
  });
}

export async function createAuthorizationRequest(redirectUri: string): Promise<{
  authorizationUrl: string;
  state: string;
}> {
  // The nonce is stored in an httpOnly cookie and compared on the way back. A
  // signed `state` alone is not enough: without the cookie comparison, an
  // attacker could feed a victim a `state` they minted and then replay the
  // resulting authorization code into their own session.
  const nonce = randomBytes(24).toString('base64url');
  const state = await signOAuthState(nonce);

  const authorizationUrl = client(redirectUri).generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    state,
    // Without this the prompt is shown every time, which is what you want for a
    // shared shop tablet.
    prompt: 'select_account',
  });

  return { authorizationUrl, state };
}

export async function assertValidOAuthState(
  state: string | undefined,
  expectedNonce: string | undefined,
): Promise<void> {
  if (!state || !expectedNonce) {
    throw new AppError(ApiErrorCode.OAUTH_FAILED, 'Sign-in session expired. Please try again.', 400);
  }

  if (!(await verifyOAuthState(state, expectedNonce))) {
    logger.warn('rejected Google callback with invalid state');
    throw new AppError(ApiErrorCode.OAUTH_FAILED, 'Sign-in could not be verified. Please try again.', 400);
  }
}

/**
 * Exchanges the authorization code for tokens and returns the verified profile.
 *
 * The id_token is verified against Google's public keys, so the email address is
 * trusted rather than merely read out of an unverified claim.
 */
export async function exchangeAuthorizationCode(
  code: string,
  redirectUri: string,
): Promise<GoogleProfile> {
  const oauth = client(redirectUri);
  let payload: TokenPayload | undefined;

  try {
    const { tokens } = await oauth.getToken(code);
    const idToken = tokens.id_token;

    if (!idToken) {
      throw new Error('Google did not return an id_token');
    }

    const ticket = await oauth.verifyIdToken({
      idToken,
      audience: googleEnv().GOOGLE_CLIENT_ID,
    });

    payload = ticket.getPayload();
  } catch (error) {
    logger.warn({ err: error }, 'Google token exchange failed');
    throw new AppError(ApiErrorCode.OAUTH_FAILED, 'Google sign-in could not be completed.', 400);
  }

  const email = payload?.email;

  if (!payload?.sub || !email || payload.email_verified !== true) {
    // Without email_verified there is no way to safely link the Google identity
    // to an existing staff account, so the sign-in is refused.
    throw new AppError(
      ApiErrorCode.OAUTH_FAILED,
      'Google did not provide a verified email address for this account.',
      400,
    );
  }

  return {
    googleId: payload.sub,
    email: email.toLowerCase(),
    name: payload.name?.trim() || email.split('@')[0] || 'Staff member',
  };
}

/**
 * Derives the public origin of this request.
 *
 * Derived rather than configured so the same deployment works on a Vercel
 * production domain, a preview domain and localhost without a redirect URI to
 * keep in sync. Requires `trust proxy`, which app.ts enables in production, for
 * req.protocol to reflect X-Forwarded-Proto.
 */
export function resolveRequestOrigin(req: {
  protocol: string;
  get(header: string): string | undefined;
}): string {
  const host = req.get('host');

  if (!host) {
    throw new AppError(ApiErrorCode.INTERNAL_ERROR, 'Could not determine request origin.', 500);
  }

  return `${req.protocol}://${host}`;
}
