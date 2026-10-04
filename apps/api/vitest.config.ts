import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Integration suites need a live PostgreSQL (TEST_DATABASE_URL). Without it
    // they skip rather than fail, so a contributor without credentials still
    // gets a green unit run.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
