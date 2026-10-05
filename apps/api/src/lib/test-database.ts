/**
 * Test suites run against a separate PostgreSQL *database*, not the live one.
 *
 * Why this matters: the inventory ledger is append-only by design. A movement row
 * cannot be updated or deleted, and the database refuses to drop a variant that
 * has history. That is exactly right for a shop's records and exactly wrong for
 * test fixtures — a suite that creates products with stock would leave them in the
 * real inventory forever, with no legal way to remove them.
 *
 * Why a database and not a schema: Prisma only honours a `?schema=` connection
 * parameter when the multiSchema preview feature is enabled, which is not something
 * to switch on for a production schema definition. A separate database needs no
 * preview features, and `DROP DATABASE` is a single statement that does not fire
 * row triggers.
 *
 * It lives on the same Neon instance, so it costs one empty database and no extra
 * credentials.
 */

export const TEST_DATABASE_NAME = 'inventory_test';

/** Points a connection string at the disposable test database. */
export function withTestDatabase(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${TEST_DATABASE_NAME}`;
  return url.toString();
}

export function isTestDatabaseUrl(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false;

  try {
    return new URL(databaseUrl).pathname.replace(/^\//, '') === TEST_DATABASE_NAME;
  } catch {
    return false;
  }
}