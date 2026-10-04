import type { Prisma } from '@prisma/client';

import {
  ApiErrorCode,
  UserRole,
  type CreateUserInput,
  type ListUsersQuery,
  type UpdateUserInput,
  type UserDto,
} from '@inventory/shared';

import { AppError, conflict, notFound } from '../../lib/errors.js';
import { hashPassword } from '../../lib/password.js';
import { prisma } from '../../lib/prisma.js';
import { isUniqueViolationOn } from '../../lib/prisma-errors.js';
import { generateTemporaryPassword } from '../../lib/temporary-password.js';
import { logger } from '../../lib/logger.js';
import { AUTH_SELECT, toUserDto } from '../../serializers/user.js';

export async function listUsers(query: ListUsersQuery): Promise<{
  items: UserDto[];
  total: number;
}> {
  const where = {
    ...(query.status === 'all' ? {} : { isActive: query.status === 'active' }),
    ...(query.role ? { role: query.role } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' as const } },
            { email: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: AUTH_SELECT,
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  return { items: users.map(toUserDto), total };
}

export async function createUser(input: CreateUserInput, actorId: string): Promise<UserDto> {
  try {
    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash: await hashPassword(input.password),
        role: input.role,
      },
      select: AUTH_SELECT,
    });

    logger.info({ actorId, targetUserId: user.id, role: user.role }, 'admin created a user');
    return toUserDto(user);
  } catch (error) {
    if (isUniqueViolationOn(error, ['email'])) {
      throw conflict(ApiErrorCode.DUPLICATE_EMAIL, 'An account with that email already exists.');
    }
    throw error;
  }
}

/**
 * Prevents the shop from locking every administrator out of user management.
 *
 * Two distinct ways to lose the last admin are guarded:
 *   - demoting the final active ADMIN to STAFF
 *   - deactivating the final active ADMIN
 *
 * The check and the update run in one transaction so two concurrent requests
 * cannot both see "one admin left" and both proceed.
 */
async function assertNotLastActiveAdmin(
  targetUserId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const target = await tx.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, role: true, isActive: true },
  });

  if (!target) throw notFound('User');

  if (target.role !== UserRole.ADMIN || !target.isActive) return;

  const remainingAdmins = await tx.user.count({
    where: { role: UserRole.ADMIN, isActive: true, id: { not: targetUserId } },
  });

  if (remainingAdmins === 0) {
    throw new AppError(
      ApiErrorCode.LAST_ACTIVE_ADMIN,
      'This is the only active administrator. Promote another user to admin first.',
      409,
    );
  }
}

export async function updateUser(
  targetUserId: string,
  input: UpdateUserInput,
  actorId: string,
): Promise<UserDto> {
  const user = await prisma.$transaction(async (tx) => {
    const demoting = input.role !== undefined && input.role !== UserRole.ADMIN;
    const deactivating = input.isActive === false;

    if (demoting || deactivating) {
      await assertNotLastActiveAdmin(targetUserId, tx);
    }

    if (input.email !== undefined) {
      await assertEmailCanBeChanged(targetUserId, input.email, tx);
    }

    try {
      const updated = await tx.user.update({
        where: { id: targetUserId },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.email === undefined ? {} : { email: input.email }),
          ...(input.role === undefined ? {} : { role: input.role }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        },
        select: AUTH_SELECT,
      });

      return updated;
    } catch (error) {
      if (isUniqueViolationOn(error, ['email'])) {
        throw conflict(
          ApiErrorCode.DUPLICATE_EMAIL,
          'Another account already uses that email address.',
        );
      }
      throw error;
    }
  });

  logger.info(
    {
      actorId,
      targetUserId,
      role: user.role,
      isActive: user.isActive,
      emailChanged: input.email !== undefined,
    },
    'admin updated a user',
  );

  return toUserDto(user);
}

/**
 * Refuses to change the email of an account that signs in with Google.
 *
 * The Google callback resolves an account by email address. Moving the account's
 * email away from the one Google asserts would leave that person unable to sign
 * in at all, and the failure would look like a bug rather than a bad edit. The
 * honest fix is to change the address in the Google account itself.
 */
async function assertEmailCanBeChanged(
  targetUserId: string,
  nextEmail: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const target = await tx.user.findUnique({
    where: { id: targetUserId },
    select: { email: true, googleId: true },
  });

  if (!target) throw notFound('User');

  // No-op change: nothing to validate, and it must not trip the Google guard.
  if (target.email === nextEmail) return;

  if (target.googleId !== null) {
    throw new AppError(
      ApiErrorCode.VALIDATION_ERROR,
      'This account signs in with Google. Change the email address in the Google account instead.',
      409,
    );
  }
}

/**
 * Issues a one-time password and flags the account so the holder is reminded to
 * replace it. This exists because a deactivated employee cannot simply be deleted:
 * their name is attached to inventory movements that must be preserved.
 *
 * The password is generated here rather than supplied by the administrator, so it
 * cannot be weak, reused from another account, or chosen from a predictable
 * pattern. It is returned exactly once and never stored in plaintext.
 */
export async function resetUserPassword(
  targetUserId: string,
  actorId: string,
): Promise<{ temporaryPassword: string }> {
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, googleId: true },
  });

  if (!target) throw notFound('User');

  if (target.googleId !== null) {
    throw new AppError(
      ApiErrorCode.VALIDATION_ERROR,
      'This account signs in with Google and has no password to reset.',
      409,
    );
  }

  const temporaryPassword = generateTemporaryPassword();

  await prisma.user.update({
    where: { id: targetUserId },
    data: {
      passwordHash: await hashPassword(temporaryPassword),
      mustChangePassword: true,
    },
  });

  logger.warn({ actorId, targetUserId }, 'admin reset a user password');
  return { temporaryPassword };
}
