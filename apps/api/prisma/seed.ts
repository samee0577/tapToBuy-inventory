/**
 * Seeds the category list a new shop needs to start filing products, so the
 * first user does not have to invent a taxonomy from nothing.
 *
 * Idempotent: categories are upserted by name, so re-running is safe.
 * Users are deliberately NOT seeded — the first Admin is created by
 * `pnpm --filter @inventory/api user:bootstrap`, which prompts for a password
 * instead of shipping a well-known default credential.
 */
import '../src/config/load-env.js';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_CATEGORIES: ReadonlyArray<{ name: string; description: string }> = [
  { name: 'T-Shirts', description: 'Casual and graphic tees' },
  { name: 'Shirts', description: 'Formal, casual and linen shirts' },
  { name: 'Polo T-Shirts', description: 'Polos and knit polos' },
  { name: 'Trousers', description: 'Formal trousers, chinos and cargos' },
  { name: 'Jeans', description: 'Slim, straight and relaxed denim' },
  { name: 'Shorts', description: 'Casual and sports shorts' },
  { name: 'Jackets', description: 'Bomber, denim and lightweight jackets' },
  { name: 'Hoodies & Sweatshirts', description: 'Hoodies, crew necks and tracksuits' },
  { name: 'Ethnic Wear', description: 'Kurta, kurti and Nehru jackets' },
  { name: 'Accessories', description: 'Belts, wallets, caps and socks' },
];

async function main(): Promise<void> {
  for (const category of DEFAULT_CATEGORIES) {
    await prisma.category.upsert({
      where: { name: category.name },
      update: { description: category.description },
      create: category,
    });
  }

  const total = await prisma.category.count();
  console.log(`Seeded categories. ${total} categories now exist.`);
}

main()
  .catch((error: unknown) => {
    console.error('Category seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
