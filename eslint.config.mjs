import tsParser from '@typescript-eslint/parser';
import plugin from '@next/eslint-plugin-next';
import vitestPlugin from '@vitest/eslint-plugin';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2024,
        sourceType: 'module',
      },
    },
    plugins: {
      '@next/next': plugin,
      vitest: vitestPlugin,
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...plugin.configs.recommended.rules,
      ...vitestPlugin.configs.recommended.rules,
      ...tsPlugin.configs['flat/recommended'].rules,
    },
  },
  {
    ignores: ['node_modules/**', '.next/**', 'out/**', 'build/**'],
  },
];