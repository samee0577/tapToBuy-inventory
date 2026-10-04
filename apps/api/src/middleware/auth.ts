import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { ApiErrorCode, type SessionUserDto, type UserRole } from '@inventory/shared';

import { SESSION_COOKIE_NAME, clearSessionCookie } from '../config/session.js';
import { AppError, forbidden, unauthorized } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { verifySessionToken } from '../lib/session-token.js';
import { REQUEST_AUTH_SELECT } from '../serializers/user.js';
import { logger } from '../lib/logger.js';

/**
 * Reads the user that requireAuth attached. Throws rather than using a non-null
 * assertion, so a missing guard surfaces as a 401 instead of a runtime crash.
 */
export function authUser(req: Request): SessionUserDto {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

/**
 * Authenticates the request from the httpOnly session cookie.
 *
 * The user row is re-read on every request rather than trusted from the token.
 * That is the whole reason a stateless token is safe here: deactivating a user or
 * changing their role takes effect on their very next request, with no session
 * store to revoke and no waiting for a token to expire. It costs one primary-key
 * lookup, which is nothing for an internal tool with a handful of users.
 */
export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (typeof token !== 'string' || token.length === 0) {
      next(unauthorized());
      return;
    }

    const claims = await verifySessionToken(token);
    if (!claims) {
      clearSessionCookie(res);
      next(unauthorized(ApiErrorCode.UNAUTHORIZED, 'Your session has expired. Please sign in again.'));
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: claims.userId },
      select: REQUEST_AUTH_SELECT,
    });

    if (!user) {
      clearSessionCookie(res);
      next(unauthorized(ApiErrorCode.UNAUTHORIZED, 'Your session is no longer valid.'));
      return;
    }

    if (!user.isActive) {
      clearSessionCookie(res);
      logger.warn({ actorId: user.id }, 'rejected request from deactivated account');
      next(
        new AppError(
          ApiErrorCode.USER_INACTIVE,
          'This account has been deactivated. Contact an administrator.',
          403,
        ),
      );
      return;
    }

    req.auth = user;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Restricts a route to the given roles. Always mounted after requireAuth.
 *
 * Authorisation lives here on the server; the frontend hides admin-only UI as a
 * convenience, but nothing financial is ever sent to a STAFF client in the first
 * place (see the role-aware serialisers).
 */
export function requireRole(...roles: readonly UserRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.auth;

    if (!user) {
      next(unauthorized());
      return;
    }

    if (!roles.includes(user.role)) {
      next(forbidden('This action is restricted to administrators.'));
      return;
    }

    next();
  };
}
