import type { Request, Response } from 'express';

import {
  ApiErrorCode,
  changePasswordSchema,
  loginSchema,
  registerSchema,
} from '@inventory/shared';

import {
  OAUTH_STATE_COOKIE_NAME,
  clearOAuthStateCookie,
  clearSessionCookie,
  setOAuthStateCookie,
  setSessionCookie,
} from '../../config/session.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { unauthorized } from '../../lib/errors.js';
import { sendData } from '../../lib/http.js';
import { logger } from '../../lib/logger.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { prisma } from '../../lib/prisma.js';
import { authUser } from '../../middleware/auth.js';
import * as authService from './auth.service.js';
import {
  GOOGLE_CALLBACK_PATH,
  assertValidOAuthState,
  createAuthorizationRequest,
  exchangeAuthorizationCode,
  resolveRequestOrigin,
} from './google.service.js';

export const login = asyncHandler(async (req: Request, res: Response) => {
  const input = loginSchema.parse(req.body);
  const { user, token } = await authService.login(input);

  setSessionCookie(res, token);
  sendData(res, { user });
});

export const register = asyncHandler(async (req: Request, res: Response) => {
  const input = registerSchema.parse(req.body);
  const { user, token } = await authService.register(input);

  setSessionCookie(res, token);
  sendData(res, { user }, 201);
});

/**
 * The session cookie is cleared by the server, not by JavaScript, so the browser
 * cannot be tricked into keeping a session the server has already ended.
 */
export const logout = asyncHandler(async (_req: Request, res: Response) => {
  clearSessionCookie(res);
  clearOAuthStateCookie(res);
  sendData(res, { loggedOut: true });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  sendData(res, { user: authUser(req) });
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const actor = authUser(req);
  const input = changePasswordSchema.parse(req.body);

  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { passwordHash: true },
  });

  if (!user?.passwordHash) {
    throw unauthorized(
      ApiErrorCode.INVALID_CREDENTIALS,
      'This account signs in with Google and has no password to change.',
    );
  }

  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw unauthorized(ApiErrorCode.INVALID_CREDENTIALS, 'Current password is incorrect.');
  }

  await prisma.user.update({
    where: { id: actor.id },
    data: { passwordHash: await hashPassword(input.newPassword) },
  });

  logger.info({ actorId: actor.id }, 'user changed their own password');
  sendData(res, { updated: true });
});

export const startGoogleSignIn = asyncHandler(async (req: Request, res: Response) => {
  const origin = resolveRequestOrigin(req);
  const { authorizationUrl, state } = await createAuthorizationRequest(
    `${origin}${GOOGLE_CALLBACK_PATH}`,
  );

  setOAuthStateCookie(res, state);
  res.redirect(302, authorizationUrl);
});

export const handleGoogleCallback = asyncHandler(async (req: Request, res: Response) => {
  const origin = resolveRequestOrigin(req);
  const redirectUri = `${origin}${GOOGLE_CALLBACK_PATH}`;

  const code = typeof req.query.code === 'string' ? req.query.code : undefined;
  const state = typeof req.query.state === 'string' ? req.query.state : undefined;
  const expectedNonce = req.cookies?.[OAUTH_STATE_COOKIE_NAME];

  clearOAuthStateCookie(res);

  try {
    // Awaited deliberately: an unawaited assertion here would reject into the
    // void and let the callback continue, defeating the CSRF check entirely.
    await assertValidOAuthState(state, expectedNonce);

    if (!code) {
      res.redirect(302, `${origin}/login?error=oauth_cancelled`);
      return;
    }

    const profile = await exchangeAuthorizationCode(code, redirectUri);
    const user = await authService.findOrCreateGoogleUser(profile);
    const { token } = await authService.issueSessionForUser(user.id);

    logger.info({ actorId: user.id }, 'user signed in with Google');
    setSessionCookie(res, token);
    res.redirect(302, `${origin}/`);
  } catch (error) {
    // Every failure path redirects rather than rendering JSON: the browser is
    // mid-navigation back from Google's origin, where a JSON body would be shown
    // to the user as raw text.
    logger.warn({ err: error }, 'Google sign-in failed');
    res.redirect(302, `${origin}/login?error=oauth_failed`);
  }
});
