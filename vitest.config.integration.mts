import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
    testTimeout: 120000,
    hookTimeout: 120000,
    teardownTimeout: 60000,
    maxWorkers: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'lib/analysis/engine.ts',
        'lib/analysis/config.ts',
        'lib/analysis/persistence.ts',
        'lib/analysis/markets/**/*.ts',
        'lib/analysis/utils/**/*.ts',
      ],
      exclude: ['**/*.d.ts'],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 90,
      },
    },
  },
  resolve: { alias: { '@': import.meta.dirname } },
});