## Testing and verification rules

Tests in this repo hit a remote Neon database, and each full run has a large fixed setup cost (`scripts/prepare-test-db.ts`). Run the minimum needed at each stage.

### While implementing (after each edit)
- Run `pnpm --filter @inventory/api typecheck` and `pnpm --filter @inventory/api lint`.
- Do not run any tests yet.

### When a feature is finished
- Run only that feature's test file:
  `pnpm --filter @inventory/api exec vitest run tests/<file>.test.ts`
- Write the tests for a feature in the same session as the feature, while the logic is fresh.
- Always use `vitest run`, never watch mode.

### Full suite
- Run `pnpm --filter @inventory/api test` only:
  1. at the end of a phase,
  2. before a commit or PR,
  3. when the Prisma schema or migrations changed, or
  4. when I ask.
- If the full suite fails, fix one failing file at a time by re-running just that file, then re-run the full suite once at the end.

### Never weaken tests to get a pass
- Do not edit, skip, delete, or loosen an existing test or assertion to make it pass.
- If you believe a test is wrong, stop and explain why, then wait for my confirmation before changing it.
- Fix the code, not the test.