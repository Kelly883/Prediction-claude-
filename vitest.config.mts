import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
    testTimeout: 60000,
    hookTimeout: 60000,
    teardownTimeout: 60000,
    maxWorkers: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      // Coverage is enforced over the "analysis engine" — the modules that
      // encode the corrected market mathematics, the confidence/model-score
      // utilities, the Poisson model, config validation and the persistence
      // boundary. Ingestion/IO modules (network adapters, cache) are exercised
      // through mocks in the adapter suites instead of real calls.
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
