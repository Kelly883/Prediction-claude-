const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

if (!testDatabaseUrl) {
  throw new Error(
    '[integration-setup] TEST_DATABASE_URL is required. Refusing to run integration tests without an explicitly configured test database.',
  );
}

// Both Prisma clients must use the exact same isolated test database.
// Never inherit DATABASE_URL or DIRECT_URL from the caller's environment.
process.env.DATABASE_URL = testDatabaseUrl;
process.env.DIRECT_URL = testDatabaseUrl;

// Keep integration tests on a single database connection.
const separator = testDatabaseUrl.includes('?') ? '&' : '?';
if (!testDatabaseUrl.includes('connection_limit=')) {
  process.env.DATABASE_URL += `${separator}connection_limit=1`;
}
if (!testDatabaseUrl.includes('pool_timeout=')) {
  const poolSeparator = process.env.DATABASE_URL!.includes('?') ? '&' : '?';
  process.env.DATABASE_URL += `${poolSeparator}pool_timeout=30`;
}

// Ensure lib/prisma.ts creates a real Prisma client for PostgreSQL tests.
process.env.INTEGRATION_TEST = 'true';
