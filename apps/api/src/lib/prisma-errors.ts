import { Prisma } from '@prisma/client';

/**
 * Translates Prisma's error codes into the small set of cases the application
 * actually handles. Everything else is a genuine fault and is left to propagate
 * to the central error handler as a 500.
 */

export function isPrismaKnownError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError;
}

export function isUniqueConstraintError(error: unknown): boolean {
  return isPrismaKnownError(error) && error.code === 'P2002';
}

/** The column or index names reported by Postgres for a unique violation. */
export function uniqueConstraintTargets(error: unknown): string[] {
  if (!isPrismaKnownError(error) || error.code !== 'P2002') return [];

  const target = error.meta?.target;
  if (Array.isArray(target)) return target.filter((entry): entry is string => typeof entry === 'string');
  return typeof target === 'string' ? [target] : [];
}

/**
 * Prisma reports the *database column* in `meta.target`, which for a mapped field
 * differs from the TypeScript field name (`product_code` vs `productCode`).
 * Comparing with underscores removed and case folded means a caller can name
 * whichever it has to hand.
 */
function normaliseIdentifier(name: string): string {
  return name.replace(/_/g, '').toLowerCase();
}

/** True when a unique violation was caused by one of the given fields. */
export function isUniqueViolationOn(error: unknown, fields: readonly string[]): boolean {
  const targets = uniqueConstraintTargets(error);
  if (targets.length === 0) return false;

  return targets.every((target) =>
    fields.some((field) => normaliseIdentifier(target) === normaliseIdentifier(field)),
  );
}

export function isNotFoundError(error: unknown): boolean {
  return isPrismaKnownError(error) && error.code === 'P2025';
}

export function isForeignKeyConstraintError(error: unknown): boolean {
  return isPrismaKnownError(error) && error.code === 'P2003';
}
