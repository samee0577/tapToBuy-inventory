import {
  ApiErrorCode,
  type LoginInput,
  type RegisterInput,
  type SessionUserDto,
} from '@inventory/shared';

import { sessionEnv } from '../../config/env.js';
import { AppError, conflict, unauthorized } from '../../lib/errors.js';
import { hashPassword, simulatePasswordVerification, verifyPassword } from '../../lib/password.js';
import { prisma } from '../../lib/prisma.js';
import { signSessionToken } from '../../lib/session-token.js';
import { logger } from '../../lib/logger.js';
import { AUTH_SELECT, toSessionUser, type UserAuthRecord } from '../../serializers/user.js';

export interface AuthResult {
  user: SessionUserDto;
  token: string;
}

const INVALID_CREDENTIALS_MESSAGE = 'Email or password is incorrect.';

/**
 * Both "no such user" and "wrong password" return the identical error, so the
 * endpoint cannot be used to discover which email addresses have accounts.
 */
function invalidCredentials(): AppError {
  return unauthorized(ApiErrorCode.INVALID_CREDENTIALS, INVALID_CREDENTIALS_MESSAGE);
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: AUTH_SELECT,
  });

  if (!user) {
    // Spend the same time hashing as a real verification would.
    await simulatePasswordVerification(input.password);
    logger.warn({ email: input.email }, 'failed login: unknown email');
    throw invalidCredentials();
  }

  // A Google-only account has no password to compare against.
  if (user.passwordHash === null) {
    await simulatePasswordVerification(input.password);
    logger.warn({ userId: user.id }, 'failed login: password login on a Google-only account');
    throw invalidCredentials();
  }

  const passwordMatches = await verifyPassword(user.passwordHash, input.password);
  if (!passwordMatches) {
    logger.warn({ userId: user.id }, 'failed login: incorrect password');
    throw invalidCredentials();
  }

  // Checked after the password so that an inactive account cannot be probed
  // without knowing the correct password.
  if (!user.isActive) {
    logger.warn({ userId: user.id }, 'rejected login: account deactivated');
    throw new AppError(
      ApiErrorCode.USER_INACTIVE,
      'This account has been deactivated. Contact an administrator.',
      403,
    );
  }

  return issueSession(user);
}

/**
 * Kept for API compatibility with §29. Closed by default: with public
 * registration enabled, anyone who found the URL could mint themselves an
 * account, and §28 reserves user management for administrators.
 *
 * Note that this can only ever create a STAFF account. An ADMIN can promote
 * someone afterwards from the user management screen.
 */
export async function register(input: RegisterInput): Promise<AuthResult> {
  if (!sessionEnv().REGISTRATION_ENABLED) {
    throw new AppError(
      ApiErrorCode.REGISTRATION_DISABLED,
      'Self-registration is disabled. Ask an administrator to create your account.',
      403,
    );
  }

  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });

  if (existing) {
    throw conflict(ApiErrorCode.DUPLICATE_EMAIL, 'An account with that email already exists.');
  }

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      role: 'STAFF',
    },
    select: AUTH_SELECT,
  });

  logger.info({ userId: user.id, role: user.role }, 'user self-registered');
  return issueSession(user);
}

async function issueSession(user: UserAuthRecord): Promise<AuthResult> {
  const sessionUser = toSessionUser(user);
  const token = await signSessionToken({
    userId: sessionUser.id,
    role: sessionUser.role,
    name: sessionUser.name,
  });

  return { user: sessionUser, token };
}

/** Used by the Google callback once an identity has been verified. */
export async function issueSessionForUser(userId: string): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: AUTH_SELECT });

  if (!user) {
    throw unauthorized(ApiErrorCode.UNAUTHORIZED, 'Account could not be loaded.');
  }

  if (!user.isActive) {
    throw new AppError(
      ApiErrorCode.USER_INACTIVE,
      'This account has been deactivated. Contact an administrator.',
      403,
    );
  }

  return issueSession(user);
}

/**
 * Creates a user record for a verified Google identity, or links the Google
 * account to an existing record with the same email.
 *
 * Linking by verified email is safe here specifically because the shop issues
 * these accounts itself: there is no public sign-up, so an address already in
 * the system is unambiguously the same human. Google asserts `email_verified`.
 */
export async function findOrCreateGoogleUser(profile: {
  googleId: string;
  email: string;
  name: string;
}): Promise<SessionUserDto> {
  const existing = await prisma.user.findUnique({
    where: { email: profile.email },
    select: AUTH_SELECT,
  });

  if (existing) {
    if (!existing.googleId) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { googleId: profile.googleId },
        select: AUTH_SELECT,
      });
      logger.info({ userId: existing.id }, 'linked Google account to existing user');
    }

    if (!existing.isActive) {
      throw new AppError(
        ApiErrorCode.USER_INACTIVE,
        'This account has been deactivated. Contact an administrator.',
        403,
      );
    }

    return toSessionUser(existing);
  }

  throw new AppError(
    ApiErrorCode.OAUTH_FAILED,
    'No account exists for this Google address. Ask an administrator to create it first.',
    403,
  );
}
