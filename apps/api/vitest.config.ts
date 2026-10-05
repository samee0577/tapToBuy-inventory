import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Integration suites need a live PostgreSQL. Without it they skip rather than
    // fail, so a contributor without credentials still gets a green unit run.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Every suite shares one disposable schema, so files must not run
    // concurrently. Otherwise a test that creates an ADMIN can satisfy another
    // file's "last active administrator" guard and make it pass for the wrong
    // reason. Correctness over speed for a suite this size.
    fileParallelism: false,
    // Vitest 2 has no `globalTeardown` option; the teardown is exported from the
    // globalSetup module instead. It runs once, after every file has finished.
    globalSetup: ['tests/global-setup.ts'],
  },
});
