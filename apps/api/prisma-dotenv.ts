import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

/**
 * Mirrors src/config/load-env.ts. Required because declaring a Prisma config file
 * switches off Prisma's implicit .env loading, so `prisma migrate` would not see
 * DATABASE_URL / DIRECT_DATABASE_URL without this.
 */
const moduleDir = dirname(fileURLToPath(import.meta.url));

for (const candidate of [resolve(moduleDir, '.env'), resolve(moduleDir, '../../.env')]) {
  if (existsSync(candidate)) {
    dotenv.config({ path: candidate });
  }
}
