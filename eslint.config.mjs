import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const nextPlugin = require('@next/eslint-plugin-next');

// `flat/recommended` is an ARRAY of config objects, not a single object with
// `.rules`. Spreading `...flat/recommended.rules` therefore yielded nothing and
// silently applied ZERO typescript-eslint rules. Merge the rules from every
// element instead.
const recommendedRules = Object.assign(
  {},
  ...tsPlugin.configs['flat/recommended'].map((entry) => entry.rules ?? {}),
);

export default [
  // Global ignores MUST be a config object containing only `ignores`; if
  // other keys (e.g. linterOptions) are present, the ignores are scoped to
  // that object's `files` (none here) and never applied globally — which
  // caused .next/ build artifacts to be linted.
  {
    ignores: ['node_modules/**', '.next/**', 'out/**', 'build/**', 'coverage/**', 'next-env.d.ts'],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
  },
  {
    plugins: {
      '@next/next': nextPlugin,
      '@typescript-eslint': tsPlugin,
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2024,
        sourceType: 'module',
      },
    },
    rules: {
      ...recommendedRules,
      // The codebase deliberately uses `any` in ~340 places (third-party
      // football API payloads, Prisma JSON, etc.). Enforcing no-explicit-any
      // as an error is not actionable here, so it is disabled. Unused
      // vars/imports are surfaced as warnings (non-failing) for gradual
      // cleanup rather than blocking CI.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  },
];
