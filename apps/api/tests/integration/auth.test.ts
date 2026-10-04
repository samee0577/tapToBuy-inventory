import { UserRole } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/lib/prisma.js';
import {
  TEST_PASSWORD,
  api,
  createTestUser,
  deleteTestUsers,
  expectNoSessionCookie,
  expectSessionCookie,
  setCookieHeaders,
  type TestUser,
} from './helpers.js';

const createdEmails: string[] = [];
const created: TestUser[] = [];

async function makeUser(options?: Parameters<typeof createTestUser>[0]): Promise<TestUser> {
  const user = await createTestUser(options);
  created.push(user);
  createdEmails.push(user.email);
  return user;
}

beforeAll(async () => {
  const admin = await makeUser({ role: UserRole.ADMIN, name: 'Auth Suite Admin' });
  createdEmails.push(admin.email);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: created.map((user) => user.id) } } });
  await deleteTestUsers(createdEmails);
});

describe('POST /api/auth/login', () => {
  it('signs in a valid user and sets a hardened session cookie', async () => {
    const user = await makeUser();
    const response = await api()
      .post('/api/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.user).toMatchObject({
      id: user.id,
      email: user.email,
      role: UserRole.STAFF,
    });

    // The password hash must never appear in any auth response.
    expect(JSON.stringify(response.body)).not.toMatch(/\$argon2/);

    const cookie = expectSessionCookie(response);
    expect(cookie).toContain('inventory_session=');
  });

  it('never returns the password hash or Google subject', async () => {
    const user = await makeUser();
    const response = await api()
      .post('/api/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(200);

    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain('passwordHash');
    expect(serialised).not.toContain('googleId');
  });

  it('rejects a wrong password without revealing whether the account exists', async () => {
    const user = await makeUser();
    const wrongPassword = await api()
      .post('/api/auth/login')
      .send({ email: user.email, password: 'WrongPassword99' })
      .expect(401);

    const unknownEmail = await api()
      .post('/api/auth/login')
      .send({ email: uniqueMissingEmail(), password: 'WrongPassword99' })
      .expect(401);

    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknownEmail.body.error.code).toBe('INVALID_CREDENTIALS');
    // Identical message, so the endpoint cannot enumerate accounts.
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);

    expectNoSessionCookie(wrongPassword);
    expectNoSessionCookie(unknownEmail);
  });

  it('refuses to authenticate a deactivated user', async () => {
    const user = await makeUser({ isActive: false });

    const response = await api()
      .post('/api/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(403);

    expect(response.body.error.code).toBe('USER_INACTIVE');
    expectNoSessionCookie(response);
  });

  it('normalises the email, so casing does not matter', async () => {
    const user = await makeUser();

    await api()
      .post('/api/auth/login')
      .send({ email: user.email.toUpperCase(), password: TEST_PASSWORD })
      .expect(200);
  });

  it('rejects a malformed body with a validation error', async () => {
    const response = await api()
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: '' })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/auth/register', () => {
  it('is disabled by default, so nobody can mint their own account', async () => {
    const response = await api()
      .post('/api/auth/register')
      .send({
        name: 'Self Signup',
        email: uniqueMissingEmail(),
        password: 'SomePassword99',
      })
      .expect(403);

    expect(response.body.error.code).toBe('REGISTRATION_DISABLED');
    expectNoSessionCookie(response);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the signed-in user for a valid session', async () => {
    const user = await makeUser();
    const login = await api()
      .post('/api/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(200);

    const cookie = expectSessionCookie(login);
    const me = await api().get('/api/auth/me').set('Cookie', cookie).expect(200);

    expect(me.body.data.user).toMatchObject({ id: user.id, role: UserRole.STAFF });
  });

  it('rejects a request with no session cookie', async () => {
    const response = await api().get('/api/auth/me').expect(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a forged token', async () => {
    const response = await api()
      .get('/api/auth/me')
      .set('Cookie', 'inventory_session=not.a.real.token')
      .expect(401);

    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a token signed with the wrong secret', async () => {
    const user = await makeUser();
    // Correct shape, but signed by an attacker who does not hold SESSION_SECRET.
    const forged =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOi' +
      Buffer.from(user.id).toString('base64url') +
      '.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    await api().get('/api/auth/me').set('Cookie', `inventory_session=${forged}`).expect(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the session cookie', async () => {
    const user = await makeUser();
    const login = await api()
      .post('/api/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(200);

    const cookie = expectSessionCookie(login);
    const logout = await api().post('/api/auth/logout').set('Cookie', cookie).expect(200);

    const cleared = setCookieHeaders(logout).find((entry) =>
      entry.startsWith('inventory_session='),
    );
    expect(cleared).toMatch(/HttpOnly/i);
  });
});

describe('Google OAuth endpoints', () => {
  it('redirects to Google with a signed state and sets the state cookie', async () => {
    const response = await api().get('/api/auth/google').expect(302);

    const location = response.headers.location ?? '';
    expect(location).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(location).toContain('state=');

    const cookies = setCookieHeaders(response);
    expect(cookies.some((cookie) => cookie.startsWith('inventory_oauth_state='))).toBe(true);
  });

  it('refuses a callback that arrives without a matching state cookie', async () => {
    // The CSRF case: an attacker feeding a victim a callback URL carrying a
    // state the attacker minted. There is no state cookie, so it must not be
    // honoured, and no session may be issued.
    const response = await api()
      .get('/api/auth/google/callback')
      .query({ code: 'anything', state: 'attacker-supplied-state' })
      .expect(302);

    expect(response.headers.location).toContain('/login?error=oauth_failed');
    expectNoSessionCookie(response);
  });

  it('refuses a callback with a code but no state at all', async () => {
    const response = await api()
      .get('/api/auth/google/callback')
      .query({ code: 'anything' })
      .expect(302);

    expect(response.headers.location).toContain('/login?error=oauth_failed');
    expectNoSessionCookie(response);
  });

  it('refuses a callback whose state cookie does not match the state parameter', async () => {
    // Start a real sign-in so a genuine state cookie exists, then tamper with the
    // state in the callback URL. The cookie/parameter comparison must reject it.
    const start = await api().get('/api/auth/google').expect(302);
    const stateCookie = setCookieHeaders(start)
      .find((cookie) => cookie.startsWith('inventory_oauth_state='))
      ?.split(';')[0];

    expect(stateCookie).toBeDefined();

    const response = await api()
      .get('/api/auth/google/callback')
      .set('Cookie', stateCookie ?? '')
      .query({ code: 'anything', state: 'tampered-state' })
      .expect(302);

    expect(response.headers.location).toContain('/login?error=oauth_failed');
    expectNoSessionCookie(response);
  });
});

function uniqueMissingEmail(): string {
  return `absent-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}
