// Integration test setup using PostgreSQL service container in CI
// This file is loaded by vitest when running integration tests

// The TEST_DATABASE_URL is set by the CI environment (GitHub Actions service container)
// For local development, start PostgreSQL manually and set TEST_DATABASE_URL
export const setup = async () => {
  if (!process.env.TEST_DATABASE_URL) {
    console.warn('[setup-integration] TEST_DATABASE_URL not set. Integration tests will be skipped.');
  }
};

export const teardown = async () => {
  // No cleanup needed for service container
};