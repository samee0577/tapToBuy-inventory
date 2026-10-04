import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

/**
 * dotenv's default behaviour only looks in process.cwd(), which for workspace
 * scripts is apps/api. Loading order gives the app-local file precedence and lets
 * the monorepo root act as a shared fallback, without an existing value ever
 * being overwritten.
 *
 * The relative depth is identical in src/config and dist/config, so the same
 * resolution works for both `tsx src/index.ts` and `node dist/index.js`.
 */
const moduleDir = dirname(fileURLToPath(import.meta.url));

const candidates = [
  resolve(moduleDir, '../../.env'),
  resolve(moduleDir, '../../../..', '.env'),
];

for (const candidate of candidates) {
  if (existsSync(candidate)) {
    dotenv.config({ path: candidate });
  }
}
