/**
 * Prepares the disposable test database before a run.
 *
 * Migrations are applied through the *unpooled* connection: Neon's pooler runs in
 * transaction mode, which cannot support the DDL a migration performs.
 *
 * Run automatically by `pnpm test`.
 */
import '../src/config/load-env.js';

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';

import { databaseEnv } from '../src/config/env.js';
import { TEST_DATABASE_NAME, withTestDatabase } from '../src/lib/test-database.js';

async function ensureDatabaseExists(): Promise<void> {
  const { DIRECT_DATABASE_URL } = databaseEnv();
  const admin = new PrismaClient({ datasources: { db: { url: DIRECT_DATABASE_URL } } });

  try {
    const existing = await admin.$queryRawUnsafe<Array<{ n: number }>>(
      'SELECT count(*)::int AS n FROM pg_database WHERE datname = $1',
      TEST_DATABASE_NAME,
    );

    if ((existing[0]?.n ?? 0) === 0) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DATABASE_NAME}"`);
      console.log(`Created database "${TEST_DATABASE_NAME}".`);
    }
  } finally {
    await admin.$disconnect();
  }
}

function applyMigrations(): void {
  const { DIRECT_DATABASE_URL } = databaseEnv();
  const migrationUrl = withTestDatabase(DIRECT_DATABASE_URL);

  // The Prisma CLI is invoked through node directly rather than via npx: spawning
  // a .cmd shim fails with EINVAL on Windows unless a shell is involved.
  const require = createRequire(import.meta.url);
  const prismaCli = require.resolve('prisma/build/index.js');

  try {
    execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: resolve(import.meta.dirname, '..'),
      env: { ...process.env, DATABASE_URL: migrationUrl, DIRECT_DATABASE_URL: migrationUrl },
      stdio: 'pipe',
    });
  } catch (error) {
    // execFileSync hides the CLI's own diagnostics; without this the failure looks
    // like a bare "command failed" with nothing to act on.
    const failure = error as { stdout?: Buffer; stderr?: Buffer; message: string };
    const detail = `${failure.stdout?.toString() ?? ''}${failure.stderr?.toString() ?? ''}`.trim();

    throw new Error(
      `prisma migrate deploy failed for "${TEST_DATABASE_NAME}":\n${detail || failure.message}`,
    );
  }
}

async function main(): Promise<void> {
  console.log(`Preparing test database "${TEST_DATABASE_NAME}"...`);

  await ensureDatabaseExists();
  applyMigrations();

  const url = withTestDatabase(databaseEnv().DATABASE_URL);
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    // Confirm we are genuinely pointed at the disposable database and that the
    // invariants migration really landed, so the suites can trust that the
    // append-only triggers exist rather than assuming it.
    const where = await prisma.$queryRawUnsafe(
      'SELECT current_database()::text AS db',
    );
    const currentDatabase = (where as Array<{ db: string }>)[0]?.db;

    if (currentDatabase !== TEST_DATABASE_NAME) {
      throw new Error(`Expected to be on "${TEST_DATABASE_NAME}" but am on "${currentDatabase}".`);
    }

    const triggers = await prisma.$queryRawUnsafe<Array<{ tgname: string }>>(
      `SELECT tgname FROM pg_trigger
       WHERE tgrelid = 'inventory_movements'::regclass AND NOT tgisinternal`,
    );

    if (!triggers.some((trigger) => trigger.tgname === 'inventory_movements_append_only')) {
      throw new Error('The test database is missing the append-only trigger.');
    }

    console.log(`Test database "${TEST_DATABASE_NAME}" is ready.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`Could not prepare the test database: ${(error as Error).message}`);
  process.exitCode = 1;
});