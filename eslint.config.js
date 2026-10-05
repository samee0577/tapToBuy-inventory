import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.vercel/**',
      '**/build/**',
      '**/*.d.ts',
      'pnpm-lock.yaml',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      /**
       * The two rules that catch real bugs: a stale closure over props or state, and
       * a hook called conditionally. `rules-of-hooks` is an error because the
       * alternatives — a ref holding the latest value, or a custom hook — are easy
       * to get subtly wrong in a way this catches for free.
       *
       * `exhaustive-deps` is a warning, not an error. It is right often enough to be
       * worth reading, but it is wrong on the deliberate cases where a dependency is
       * intentionally omitted (a one-time seed guarded by a ref, a debounce that must
       * not restart), and those are marked inline with a reason.
       */
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // CLI entry points: a seed or bootstrap script talks to the operator on
    // stdout, which is its entire purpose.
    files: ['**/*.config.{js,ts}', '**/scripts/**/*.{js,ts}', '**/prisma/seed.ts'],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
