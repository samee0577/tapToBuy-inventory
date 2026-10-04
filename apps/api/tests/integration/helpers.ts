/**
 * Shared helpers for database-backed suites.
 *
 * These suites write to the configured database. Every record is created with a
 * distinctive prefix and removed in the suite's own afterAll. Note that
 * inventory_movements are append-only by design and therefore cannot be deleted;
 * any suite that leaves movement history behind must be pointed at a disposable
 * Neon branch via TEST_DATABASE_URL rather than the primary database.
 */
import { UserRole } from '@prisma/client';
import { expect } from 'vitest';
import type { Response } from 'supertest';
import supertest from 'supertest';

import { createApp } from '../../src/app.js';
import { SESSION_COOKIE_NAME } from '../../src/config/session.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { signSessionToken } from '../../src/lib/session-token.js';

export const app = createApp();

export const TEST_PASSWORD = 'TestPassword99';

let counter = 0;

export function uniqueEmail(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@example.test`;
}

export interface TestUser {
  id: string;
  email: string;
  role: UserRole;
}

export async function createTestUser(options?: {
  role?: UserRole;
  isActive?: boolean;
  email?: string;
  name?: string;
}): Promise<TestUser> {
  const email = options?.email ?? uniqueEmail('test');

  const user = await prisma.user.create({
    data: {
      name: options?.name ?? 'Test User',
      email,
      passwordHash: await hashPassword(TEST_PASSWORD),
      role: options?.role ?? UserRole.STAFF,
      isActive: options?.isActive ?? true,
    },
    select: { id: true, email: true, role: true },
  });

  return user;
}

export async function deleteTestUsers(emails: readonly string[]): Promise<void> {
  if (emails.length === 0) return;
  await prisma.user.deleteMany({ where: { email: { in: [...emails] } } });
}

/**
 * Mints a session token directly so a test can assert on authorisation without
 * depending on the login endpoint's behaviour.
 */
export async function tokenFor(user: TestUser): Promise<string> {
  return signSessionToken({ userId: user.id, role: user.role, name: 'Test User' });
}

/** Explicit Cookie header, so each request's auth state is visible in the test. */
export async function authCookie(user: TestUser): Promise<Record<string, string>> {
  return { Cookie: `${SESSION_COOKIE_NAME}=${await tokenFor(user)}` };
}

/** supertest types set-cookie as string | string[], so normalise it once here. */
export function setCookieHeaders(response: Response): string[] {
  const header = response.headers['set-cookie'];
  if (!header) return [];
  return Array.isArray(header) ? header : [header];
}

/** Asserts the response set a hardened session cookie and returns its value. */
export function expectSessionCookie(response: Response): string {
  const cookies = setCookieHeaders(response);
  const sessionCookie = cookies.find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`));

  expect(sessionCookie, 'expected a session cookie to be set').toBeDefined();

  const cookie = sessionCookie ?? '';
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/SameSite=Lax/i);
  expect(cookie).toMatch(/Path=\//i);

  return cookie.split(';')[0] ?? '';
}

export function expectNoSessionCookie(response: Response): void {
  const setsSession = setCookieHeaders(response).some((cookie) =>
    cookie.startsWith(`${SESSION_COOKIE_NAME}=`),
  );
  expect(setsSession).toBe(false);
}

export function api() {
  return supertest(app);
}
