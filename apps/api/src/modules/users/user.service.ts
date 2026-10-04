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

    const updated = await tx.user.update({
      where: { id: targetUserId },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.role === undefined ? {} : { role: input.role }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      },
      select: AUTH_SELECT,
    });

    return updated;
  });

  logger.info(
    {
      actorId,
      targetUserId,
      role: user.role,
      isActive: user.isActive,
    },
    'admin updated a user',
  );

  return toUserDto(user);
}
