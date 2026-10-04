import { Prisma, PrismaClient } from '@prisma/client';

import { databaseEnv, env, isProduction, isTest } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Vercel gives each serverless invocation a fresh module scope, so the client is
 * created once per cold start. Locally, tsx watch reloads modules on every save;
 * caching on globalThis prevents connection exhaustion while developing.
 */
function createClient(): PrismaClient {
  // Validates that DATABASE_URL is present and gives an actionable error naming
  // the missing variable, instead of Prisma's terse constructor failure.
  databaseEnv();

  return new PrismaClient({
    // Statement logging is opt-in via LOG_LEVEL=debug; it is far too noisy for
    // normal operation and can echo parameter values into the logs. It is
    // silenced entirely under test, where constraint violations are the expected
    // result rather than a fault.
    log: isTest ? [] : env.LOG_LEVEL === 'debug' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}

const globalForPrisma = globalThis as unknown as { __inventoryPrisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.__inventoryPrisma ?? createClient();

if (!isProduction) {
  globalForPrisma.__inventoryPrisma = prisma;
}

export { Prisma };

/** Converts a Prisma Decimal to the canonical money string used on the wire. */
export function toMoneyString(value: Prisma.Decimal | null | undefined): string {
  if (value === null || value === undefined) return '0.00';
  return value.toFixed(2);
}

export function toNullableMoneyString(value: Prisma.Decimal | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toFixed(2);
}

/** Converts a money string from the API into the exact Decimal Prisma expects. */
export function toDecimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

export type { PrismaClient };

/** Logs Prisma's structured error detail without leaking the connection string. */
export function logPrismaFailure(operation: string, error: unknown): void {
  logger.error({ operation, err: error }, 'database operation failed');
}
