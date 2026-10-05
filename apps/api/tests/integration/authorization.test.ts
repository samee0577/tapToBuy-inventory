import { UserRole } from '@prisma/client';
import { afterAll, describe, expect, it, onTestFinished } from 'vitest';

import { ApiErrorCode } from '@inventory/shared';

import { prisma } from '../../src/lib/prisma.js';
import {
  TEST_PASSWORD,
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

/**
 * Establishes the precondition these tests need: that `keep` are the only active
 * administrators in the database.
 *
 * The guard under test counts every active admin, so it can only be exercised when
 * the suite knows there are no others. Earlier suites in this run legitimately
 * leave admins behind — products.test.ts cannot clean up, because the fixtures it
 * creates are referenced by append-only rows. Asserting a precondition instead of
 * inheriting whatever the previous suite happened to leave is what makes these
 * tests deterministic rather than order-dependent.
 */
async function isolateActiveAdmins(keep: readonly string[]): Promise<void> {
  await prisma.user.updateMany({
    where: { role: UserRole.ADMIN, isActive: true, id: { notIn: [...keep] } },
    data: { isActive: false },
  });
}

describe('the last active administrator is protected', () => {
  it('refuses to demote the only active admin', async () => {
    const admin = await makeUser({ role: UserRole.ADMIN });
    const otherAdmin = await makeUser({ role: UserRole.ADMIN });
    await isolateActiveAdmins([admin.id, otherAdmin.id]);

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
    await isolateActiveAdmins([admin.id, otherAdmin.id]);

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
    await isolateActiveAdmins([admin.id]);

    await api()
      .patch(`/api/users/${staff.id}`)
      .set(await authCookie(admin))
      .send({ isActive: false })
      .expect(200);
  });
});

describe('administrators can correct an email address', () => {
  it('changes the email and normalises it to lowercase', async () => {
    const admin = await makeUser({ role: UserRole.ADMIN });
    const staff = await makeUser({ role: UserRole.STAFF });
    const newEmail = `Corrected-${Date.now()}@Example.COM`;

    const response = await api()
      .patch(`/api/users/${staff.id}`)
      .set(await authCookie(admin))
      .send({ email: newEmail })
      .expect(200);

    expect(response.body.data.email).toBe(newEmail.toLowerCase());

    const persisted = await prisma.user.findUniqueOrThrow({
      where: { id: staff.id },
      select: { email: true },
    });
    expect(persisted.email).toBe(newEmail.toLowerCase());
  });

  it('lets the user sign in with the corrected address', async () => {
    const admin = await makeUser({ role: UserRole.ADMIN });
    const staff = await makeUser({ role: UserRole.STAFF });
    const newEmail = `signin-${Date.now()}@example.test`;

    await api()
      .patch(`/api/users/${staff.id}`)
      .set(await authCookie(admin))
      .send({ email: newEmail })
      .expect(200);

    await api()
      .post('/api/auth/login')
      .send({ email: newEmail, password: TEST_PASSWORD })
      .expect(200);
  });

  it('rejects an email already used by another account', async () => {
    const admin = await makeUser({ role: UserRole.ADMIN });
    const other = await makeUser({ role: UserRole.STAFF });

    const response = await api()
      .patch(`/api/users/${other.id}`)
      .set(await authCookie(admin))
      .send({ email: admin.email })
      .expect(409);

    expect(response.body.error.code).toBe(ApiErrorCode.DUPLICATE_EMAIL);
  });

  it('refuses to change the email of a Google-linked account', async () => {
    const admin = await makeUser({ role: UserRole.ADMIN });
    const googleUser = await makeUser({ role: UserRole.STAFF });

    // Simulate the account having completed a Google sign-in at least once.
    await prisma.user.update({
      where: { id: googleUser.id },
      data: { googleId: `google-${Date.now()}` },
    });

    const response = await api()
      .patch(`/api/users/${googleUser.id}`)
      .set(await authCookie(admin))
      .send({ email: `changed-${Date.now()}@example.test` })
      .expect(409);

    expect(response.body.error.code).toBe(ApiErrorCode.VALIDATION_ERROR);
    expect(response.body.error.message).toMatch(/Google/i);

    const persisted = await prisma.user.findUniqueOrThrow({
      where: { id: googleUser.id },
      select: { email: true },
    });
    expect(persisted.email).toBe(googleUser.email);
  });

  it('still allows unrelated changes to a Google-linked account', async () => {
    const admin = await makeUser({ role: UserRole.ADMIN });
    const googleUser = await makeUser({ role: UserRole.STAFF });

    await prisma.user.update({
      where: { id: googleUser.id },
      data: { googleId: `google-${Date.now()}` },
    });

    await api()
      .patch(`/api/users/${googleUser.id}`)
      .set(await authCookie(admin))
      .send({ name: 'Renamed Person', isActive: false })
      .expect(200);
  });

  it('rejects a malformed email', async () => {
    const admin = await makeUser({ role: UserRole.ADMIN });
    const staff = await makeUser({ role: UserRole.STAFF });

    const response = await api()
      .patch(`/api/users/${staff.id}`)
      .set(await authCookie(admin))
      .send({ email: 'not-an-email' })
      .expect(400);

    expect(response.body.error.code).toBe(ApiErrorCode.VALIDATION_ERROR);
  });
});

describe('administrators can issue a temporary password', () => {
  it('returns a usable password once and flags the account', async () => {
    const admin = await makeUser({ role: UserRole.ADMIN });
    const staff = await makeUser({ role: UserRole.STAFF });

    const response = await api()
      .post(`/api/users/${staff.id}/reset-password`)
      .set(await authCookie(admin))
      .expect(200);

    const temporaryPassword = response.body.data.temporaryPassword;
    expect(typeof temporaryPassword).toBe('string');
    expect(temporaryPassword.length).toBeGreaterThanOrEqual(12);
    expect(response.body.data.mustChangePassword).toBe(true);
    // The generated value must never be echoed back inside a hash.
    expect(JSON.stringify(response.body)).not.toMatch(/\$argon2/);

    const persisted = await prisma.user.findUniqueOrThrow({
      where: { id: staff.id },
      select: { mustChangePassword: true },
    });
    expect(persisted.mustChangePassword).toBe(true);

    // It works for sign-in, and the old password stops working.
    await api()
      .post('/api/auth/login')
      .send({ email: staff.email, password: temporaryPassword })
      .expect(200);

    await api()
      .post('/api/auth/login')
      .send({ email: staff.email, password: TEST_PASSWORD })
      .expect(401);
  });

  it('reports the reminder on the session so the UI can prompt', async () => {
    const admin = await makeUser({ role: UserRole.ADMIN });
    const staff = await makeUser({ role: UserRole.STAFF });

    const reset = await api()
      .post(`/api/users/${staff.id}/reset-password`)
      .set(await authCookie(admin))
      .expect(200);

    const login = await api()
      .post('/api/auth/login')
      .send({ email: staff.email, password: reset.body.data.temporaryPassword })
      .expect(200);

    expect(login.body.data.user.mustChangePassword).toBe(true);

    const me = await api().get('/api/auth/me').set(await authCookie(staff)).expect(200);
    expect(me.body.data.user.mustChangePassword).toBe(true);
  });

  it('is cleared once the user changes their own password', async () => {
    const admin = await makeUser({ role: UserRole.ADMIN });
    const staff = await makeUser({ role: UserRole.STAFF });

    const reset = await api()
      .post(`/api/users/${staff.id}/reset-password`)
      .set(await authCookie(admin))
      .expect(200);

    const temporaryPassword = reset.body.data.temporaryPassword as string;

    const staffCookie = await authCookie(staff);
    const change = await api()
      .post('/api/auth/change-password')
      .set(staffCookie)
      .send({ currentPassword: temporaryPassword, newPassword: 'BrandNewPass77' })
      .expect(200);

    expect(change.body.data.mustChangePassword).toBe(false);

    const persisted = await prisma.user.findUniqueOrThrow({
      where: { id: staff.id },
      select: { mustChangePassword: true },
    });
    expect(persisted.mustChangePassword).toBe(false);

    await api()
      .post('/api/auth/login')
      .send({ email: staff.email, password: 'BrandNewPass77' })
      .expect(200);
  });

  it('refuses a STAFF user the ability to reset anyone', async () => {
    const staff = await makeUser({ role: UserRole.STAFF });
    const victim = await makeUser({ role: UserRole.STAFF });

    await api()
      .post(`/api/users/${victim.id}/reset-password`)
      .set(await authCookie(staff))
      .expect(403);

    // And the victim's password is untouched.
    await api()
      .post('/api/auth/login')
      .send({ email: victim.email, password: TEST_PASSWORD })
      .expect(200);
  });

  it('refuses to reset a Google-only account', async () => {
    const admin = await makeUser({ role: UserRole.ADMIN });
    const googleUser = await makeUser({ role: UserRole.STAFF });

    await prisma.user.update({
      where: { id: googleUser.id },
      data: { googleId: `google-${Date.now()}` },
    });

    const response = await api()
      .post(`/api/users/${googleUser.id}/reset-password`)
      .set(await authCookie(admin))
      .expect(409);

    expect(response.body.error.message).toMatch(/Google/i);
  });

  it('does not affect the last active administrator', async () => {
    // Resetting a password is orthogonal to the admin guard: it neither promotes
    // nor demotes anyone, so it must remain available for a locked-out admin.
    const admin = await makeUser({ role: UserRole.ADMIN });

    const response = await api()
      .post(`/api/users/${admin.id}/reset-password`)
      .set(await authCookie(admin))
      .expect(200);

    expect(typeof response.body.data.temporaryPassword).toBe('string');
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
