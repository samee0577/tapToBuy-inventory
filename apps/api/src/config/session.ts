import type { CookieOptions, Response } from 'express';

import { isProduction, sessionEnv } from './env.js';

export const SESSION_COOKIE_NAME = 'inventory_session';

/** Lives only for the OAuth round trip, which completes in seconds. */
export const OAUTH_STATE_COOKIE_NAME = 'inventory_oauth_state';

const BASE_COOKIE: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  // Secure in production only, so plain-HTTP localhost development still works.
  secure: isProduction,
};

/**
 * SameSite=Lax with Secure-in-production is sufficient *because* the SPA and the
 * API share an origin (one Vercel project). Lax cookies are not sent on
 * cross-site sub-requests, so a third-party site cannot ride the session; no
 * SameSite=None and no CSRF token is needed for the JSON API, which is only ever
 * reachable same-origin.
 */
export function sessionCookieOptions(): CookieOptions {
  return { ...BASE_COOKIE, maxAge: sessionEnv().SESSION_TTL_SECONDS * 1000 };
}

export function oauthStateCookieOptions(): CookieOptions {
  return { ...BASE_COOKIE, maxAge: 10 * 60 * 1000 };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions());
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, { ...BASE_COOKIE, maxAge: undefined });
}

export function setOAuthStateCookie(res: Response, state: string): void {
  res.cookie(OAUTH_STATE_COOKIE_NAME, state, oauthStateCookieOptions());
}

export function clearOAuthStateCookie(res: Response): void {
  res.clearCookie(OAUTH_STATE_COOKIE_NAME, { ...BASE_COOKIE, maxAge: undefined });
}
