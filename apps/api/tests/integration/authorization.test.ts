import { UserRole } from '@prisma/client';
import { afterAll, describe, expect, it, onTestFinished } from 'vitest';

import { ApiErrorCode } from '@inventory/shared';

import { prisma } from '../../src/lib/prisma.js';
import {
  api,
  authCookie,
  createTestUser,
  deleteTestUsers,
  type TestUser,
} from './helpers.js';

const created: TestUser[] = [];
const emails: string[] = [];

/**
 * Cleanup is registered per-test rather than once in afterAll. That matters here:
 * several tests mutate global state (promoting a user to ADMIN, deactivating
 * one), and the last-active-admin rule counts every admin in the database. With
 * suite-level cleanup a lingering admin from an earlier test would silently make
 * the guard tests pass for the wrong reason.
 */
async function makeUser(options?: Parameters<typeof createTestUser>[0]): Promise<TestUser> {
  const user = await createTestUser(options);
  created.push(user);
  emails.push(user.email);

  onTestFinished(async () => {
    await prisma.user.deleteMany({ where: { id: user.id } });
  });

  return user;
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: created.map((user) => user.id) } } });
  await deleteTestUsers(emails);
});

describe('authentication is required', () => {
  it.each([
    ['get', '/api/users'],
    ['post', '/api/users'],
    ['patch', '/api/users/00000000-0000-4000-8000-000000000000'],
  ])('rejects an unauthenticated %s %s', async (method, path) => {
    const response = await api()
      [method as 'get' | 'post' | 'patch'](path)
      .send({})
      .expect(401);

    expect(response.body.error.code).toBe(ApiErrorCode.UNAUTHORIZED);
  });
});

describe('role-based access control on user management', () => {
  it('lets an ADMIN list users', async () => {
    const admin = await makeUser({ role: UserRole.ADMIN });
    const response = await api()
      .get('/api/users')
      .set(await authCookie(admin))
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data.items)).toBe(true);
  });

  it('refuses a STAFF user access to user management', async () => {
    const staff = await makeUser({ role: UserRole.STAFF });
    const response = await api()
      .get('/api/users')
      .set(await authCookie(staff))
      .expect(403);

    expect(response.body.error.code).toBe(ApiErrorCode.FORBIDDEN);
  });

  it('refuses a STAFF user the ability to create other users', async () => {
    const staff = await makeUser({ role: UserRole.STAFF });

    const response = await api()
      .post('/api/users')
      .set(await authCookie(staff))
      .send({
        name: 'Backdoor',
        email: `escalation-${Date.now()}@example.test`,
        password: 'Escalation99',
        role: UserRole.ADMIN,
      })
      .expect(403);

    expect(response.body.error.code).toBe(ApiErrorCode.FORBIDDEN);
  });

  it('refuses a STAFF user the ability to promote themselves to ADMIN', async () => {
    const staff = await makeUser({ role: UserRole.STAFF });

    const response = await api()
      .patch(`/api/users/${staff.id}`)
      .set(await authCookie(staff))
      .send({ role: UserRole.ADMIN })
      .expect(403);

    expect(response.body.error.code).toBe(ApiErrorCode.FORBIDDEN);

    // The role must be unchanged in the database, not merely hidden from the UI.
    const persisted = await prisma.user.findUniqueOrThrow({
      where: { id: staff.id },
      select: { role: true },
    });
    expect(persisted.role).toBe(UserRole.STAFF);
  });
});

describe('deactivation takes effect immediately', () => {
  it('rejects a valid session from a user deactivated after the token was issued', async () => {
    const staff = await makeUser({ role: UserRole.STAFF });

    // The cookie is minted while the account is still active.
    const cookie = await authCookie(staff);
    await api().get('/api/auth/me').set(cookie).expect(200);

    // An administrator deactivates them. No token revocation is needed because
    // requireAuth re-reads the user on every request.
    await prisma.user.update({ where: { id: staff.id }, data: { isActive: false } });

    const response = await api().get('/api/auth/me').set(cookie).expect(403);
    expect(response.body.error.code).toBe(ApiErrorCode.USER_INACTIVE);

    await prisma.user.update({ where: { id: staff.id }, data: { isActive: true } });
  });

  it('applies a role change on the very next request', async () => {
    const user = await makeUser({ role: UserRole.STAFF });
    const cookie = await authCookie(user);

    await api().get('/api/users').set(cookie).expect(403);

    await prisma.user.update({ where: { id: user.id }, data: { role: UserRole.ADMIN } });

    // Same cookie, now permitted: authorisation reads live state, not the token.
    await api().get('/api/users').set(cookie).expect(200);
  });
});

describe('the last active administrator is protected', () => {
  it('refuses to demote the only active admin', async () => {
    const admin = await makeUser({ role: UserRole.ADMIN });
    const otherAdmin = await makeUser({ role: UserRole.ADMIN });

    // With a second admin present, demotion is allowed.
    await api()
      .patch(`/api/users/${admin.id}`)
      .set(await authCookie(otherAdmin))
      .send({ role: UserRole.STAFF })
      .expect(200);

    // admin is now the only active admin, so the last one cannot be demoted.
    const response = await api()
      .patch(`/api/users/${otherAdmin.id}`)
      .set(await authCookie(otherAdmin))
      .send({ role: UserRole.STAFF })
      .expect(409);

    expect(response.body.error.code).toBe(ApiErrorCode.LAST_ACTIVE_ADMIN);
  });

  it('refuses to deactivate the only active admin', async () => {
    const admin = await makeUser({ role: UserRole.ADMIN });
    const otherAdmin = await makeUser({ role: UserRole.ADMIN });

    await api()
      .patch(`/api/users/${admin.id}`)
      .set(await authCookie(otherAdmin))
      .send({ isActive: false })
      .expect(200);

    const response = await api()
      .patch(`/api/users/${otherAdmin.id}`)
      .set(await authCookie(otherAdmin))
      .send({ isActive: false })
      .expect(409);

    expect(response.body.error.code).toBe(ApiErrorCode.LAST_ACTIVE_ADMIN);
  });

  it('does not block changes to a staff member when only one admin exists', async () => {
    const admin = await makeUser({ role: UserRole.ADMIN });
    const staff = await makeUser({ role: UserRole.STAFF });

    await api()
      .patch(`/api/users/${staff.id}`)
      .set(await authCookie(admin))
      .send({ isActive: false })
      .expect(200);
  });
});

describe('users cannot be deleted', () => {
  it('has no DELETE route, so history is preserved', async () => {
    const admin = await makeUser({ role: UserRole.ADMIN });

    const response = await api()
      .delete(`/api/users/${admin.id}`)
      .set(await authCookie(admin))
      .expect(404);

    // The row must still exist.
    const persisted = await prisma.user.findUnique({
      where: { id: admin.id },
      select: { id: true },
    });
    expect(persisted).not.toBeNull();
    expect(response.body.error.code).toBe(ApiErrorCode.NOT_FOUND);
  });
});

describe('user creation rules', () => {
  it('rejects a duplicate email', async () => {
    const admin = await makeUser({ role: UserRole.ADMIN });
    const existing = await makeUser({ role: UserRole.STAFF });

    const response = await api()
      .post('/api/users')
      .set(await authCookie(admin))
      .send({
        name: 'Duplicate',
        email: existing.email,
        password: 'Duplicate99',
        role: UserRole.STAFF,
      })
      .expect(409);

    expect(response.body.error.code).toBe(ApiErrorCode.DUPLICATE_EMAIL);
  });

  it('never returns the password hash of a created user', async () => {
    const admin = await makeUser({ role: UserRole.ADMIN });
    const email = `fresh-${Date.now()}@example.test`;

    const response = await api()
      .post('/api/users')
      .set(await authCookie(admin))
      .send({ name: 'Fresh Staff', email, password: 'FreshStaff99', role: UserRole.STAFF })
      .expect(201);

    // This user is created through the API rather than by makeUser, so it has to
    // be registered for cleanup explicitly or it leaks into the database.
    onTestFinished(async () => {
      await prisma.user.deleteMany({ where: { email } });
    });

    expect(JSON.stringify(response.body)).not.toMatch(/\$argon2/);
    expect(response.body.data.hasPassword).toBe(true);
  });

  it('validates the payload server-side', async () => {
    const admin = await makeUser({ role: UserRole.ADMIN });

    const response = await api()
      .post('/api/users')
      .set(await authCookie(admin))
      .send({ name: 'x', email: 'bad', password: 'short', role: 'SUPERUSER' })
      .expect(400);

    expect(response.body.error.code).toBe(ApiErrorCode.VALIDATION_ERROR);
  });
});
