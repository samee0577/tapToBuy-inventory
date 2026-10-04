/**
 * Confirms the schema, business constraints and append-only triggers are actually
 * installed in the target database.
 *
 * Useful after a production deploy: it answers "did the invariants migration
 * really run?" without hand-writing SQL. Exits non-zero if anything critical is
 * missing, so it can gate a release.
 */
import '../src/config/load-env.js';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const EXPECTED_TABLES = [
  'users',
  'categories',
  'products',
  'product_variants',
  'inventory_movements',
  'price_history',
] as const;

const EXPECTED_TRIGGERS = [
  'inventory_movements_append_only',
  'price_history_append_only',
  'product_variants_no_hard_delete',
] as const;

const EXPECTED_CHECK_CONSTRAINTS = [
  'product_variants_stock_non_negative',
  'product_variants_prices_non_negative',
  'product_variants_size_upper',
  'inventory_movements_quantity_positive',
  'inventory_movements_quantity_reconciles',
  'inventory_movements_stock_non_negative',
  'products_product_code_upper',
  'users_email_lowercase',
] as const;

type NameRow = { name: string };

async function main(): Promise<void> {
  const problems: string[] = [];

  const tables = await prisma.$queryRaw<NameRow[]>`
    SELECT table_name AS name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `;
  const tableNames = new Set(tables.map((row) => row.name));

  const triggers = await prisma.$queryRaw<NameRow[]>`
    SELECT trigger_name AS name FROM information_schema.triggers
    WHERE trigger_schema = 'public'
  `;
  const triggerNames = new Set(triggers.map((row) => row.name));

  const checks = await prisma.$queryRaw<NameRow[]>`
    SELECT conname AS name
    FROM pg_constraint
    WHERE contype = 'c' AND connamespace = 'public'::regnamespace
  `;
  const checkNames = new Set(checks.map((row) => row.name));

  const indexes = await prisma.$queryRaw<NameRow[]>`
    SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'public'
  `;

  console.log(`Tables (${tableNames.size}): ${[...tableNames].sort().join(', ')}`);
  console.log(`Indexes (${indexes.length}): ${indexes.length}`);
  console.log(`Check constraints (${checkNames.size}): ${[...checkNames].sort().join(', ')}`);
  console.log(`Triggers (${triggerNames.size}): ${[...triggerNames].sort().join(', ')}`);

  for (const table of EXPECTED_TABLES) {
    if (!tableNames.has(table)) problems.push(`missing table: ${table}`);
  }
  for (const trigger of EXPECTED_TRIGGERS) {
    if (!triggerNames.has(trigger)) problems.push(`missing trigger: ${trigger}`);
  }
  for (const constraint of EXPECTED_CHECK_CONSTRAINTS) {
    if (!checkNames.has(constraint)) problems.push(`missing check constraint: ${constraint}`);
  }

  const [users, categories, products, variants, movements, prices] = await Promise.all([
    prisma.user.count(),
    prisma.category.count(),
    prisma.product.count(),
    prisma.productVariant.count(),
    prisma.inventoryMovement.count(),
    prisma.priceHistory.count(),
  ]);

  console.log(
    `Rows — users: ${users}, categories: ${categories}, products: ${products}, ` +
      `variants: ${variants}, movements: ${movements}, priceHistory: ${prices}`,
  );

  if (problems.length > 0) {
    console.error('\nVERIFICATION FAILED:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }

  console.log('\nAll schema, constraint and trigger expectations satisfied.');
}

main()
  .catch((error: unknown) => {
    console.error('Verification could not run:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
