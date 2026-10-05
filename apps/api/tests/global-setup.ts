/**
 * Points the whole test run at the disposable test database.
 *
 * This must run in Vitest's main process before any worker imports the Prisma
 * client, which is exactly what `globalSetup` does. Vitest forks workers with the
 * parent's environment, so setting process.env here propagates to every suite.
 *
 * The guard in tests/helpers.ts is the backstop: if this file somehow did not take
 * effect, the suites refuse to run rather than write fixtures into the shop's real
 * inventory — which, because the ledger is append-only, could never be cleaned up.
 */
import '../src/config/load-env.js';

import { PrismaClient } from '@prisma/client';

import { databaseEnv } from '../src/config/env.js';
import { TEST_DATABASE_NAME, withTestDatabase } from '../src/lib/test-database.js';

export async function setup(): Promise<void> {
  const { DATABASE_URL, DIRECT_DATABASE_URL } = databaseEnv();

  process.env.DATABASE_URL = withTestDatabase(DATABASE_URL);
  process.env.DIRECT_DATABASE_URL = withTestDatabase(DIRECT_DATABASE_URL);

  // Verify rather than assume. This is the last point at which a mistake here
  // would still be caught before a worker starts writing.
  const prisma = new PrismaClient();
  try {
    const where = await prisma.$queryRawUnsafe('SELECT current_database()::text AS db');
    const current = (where as Array<{ db: string }>)[0]?.db;

    if (current !== TEST_DATABASE_NAME) {
      throw new Error(
        `Test run is pointed at database "${current}", expected "${TEST_DATABASE_NAME}". Refusing to continue.`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

export async function teardown(): Promise<void> {
  // Intentionally empty. The database is dropped and recreated by
  // prepare-test-db.ts before each run, so there is nothing to unwind and no
  // cleanup that could fail on an append-only row.
}