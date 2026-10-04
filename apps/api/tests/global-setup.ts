/**
 * Safety net for the database-backed suites.
 *
 * Individual tests are responsible for deleting the users they create, but a
 * failing assertion can skip that cleanup and leave rows behind. Because every
 * fixture uses the reserved @example.test domain, any user still carrying it
 * once the whole run has finished is by definition a leftover and can be removed
 * unconditionally.
 *
 * This runs after every test file has completed, so it cannot pull a fixture out
 * from under a test that is still using it.
 */
// This module runs in Vitest's main process, which does not go through
// src/index.ts, so the .env loader has to be imported explicitly.
import '../src/config/load-env.js';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function setup(): Promise<void> {
  // Nothing to prepare. The teardown below is the point of this file.
}

export async function teardown(): Promise<void> {
  try {
    const result = await prisma.user.deleteMany({
      where: { email: { endsWith: '@example.test' } },
    });

    if (result.count > 0) {
      console.warn(`Cleaned up ${result.count} leftover test user(s).`);
    }
  } finally {
    await prisma.$disconnect();
  }
}
