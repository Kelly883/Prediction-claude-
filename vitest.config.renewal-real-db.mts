import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/renewal-integration-setup.ts'],
    include: ['tests/renewal-f02-real-db.integration.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
    testTimeout: 120000,
    hookTimeout: 120000,
    teardownTimeout: 60000,
    maxWorkers: 1,
    // These tests touch real Postgres; no coverage thresholds needed here.
  },
  resolve: { alias: { '@': import.meta.dirname } },
});
