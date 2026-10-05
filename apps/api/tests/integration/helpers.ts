/**
 * Shared helpers for database-backed suites.
 *
 * Every suite runs against the disposable `inventory_test` database, prepared by
 * scripts/prepare-test-db.ts before each run. That matters because inventory
 * movements are append-only by design: fixtures created in the live schema could
 * never be removed.
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
import { isTestDatabaseUrl } from '../../src/lib/test-database.js';

/**
 * Hard stop against writing fixtures into the shop's real inventory.
 *
 * The inventory ledger is append-only, so a test product with stock could never be
 * cleaned up if it landed in the live database. globalSetup points DATABASE_URL at
 * a disposable database; this checks that actually took effect before any suite is
 * allowed to import the Prisma client and write.
 */
if (!isTestDatabaseUrl(process.env.DATABASE_URL)) {
  throw new Error(
    'Refusing to run: DATABASE_URL does not point at the test database.\n' +
      'Integration tests must be launched with `pnpm --filter @inventory/api test`, ' +
      'which invokes scripts/prepare-test-db.ts first.\n' +
      `Current database: ${
        process.env.DATABASE_URL
          ? new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '') || '(none)'
          : '(unset)'
      }`,
  );
}

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
