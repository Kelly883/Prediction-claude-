const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

if (!testDatabaseUrl) {
  throw new Error(
    '[renewal-integration-setup] TEST_DATABASE_URL is required. Refusing to run real-DB renewal integration tests without an explicitly configured test database.',
  );
}

// Point Prisma at the real Neon test database for the whole test file.
process.env.DATABASE_URL = testDatabaseUrl;
process.env.DIRECT_URL = testDatabaseUrl;

// Single connection so concurrent test queries cannot deadlock each other.
const separator = testDatabaseUrl.includes('?') ? '&' : '?';
if (!testDatabaseUrl.includes('connection_limit=')) {
  process.env.DATABASE_URL += `${separator}connection_limit=1`;
}
if (!testDatabaseUrl.includes('pool_timeout=')) {
  const poolSeparator = process.env.DATABASE_URL!.includes('?') ? '&' : '?';
  process.env.DATABASE_URL += `${poolSeparator}pool_timeout=60`;
}
// Increase interactive transaction timeout to 60 seconds (Neon default is 5s)
if (!testDatabaseUrl.includes('options=')) {
  const optionsSeparator = process.env.DATABASE_URL!.includes('?') ? '&' : '?';
  process.env.DATABASE_URL += `${optionsSeparator}options=-c%20idle_in_transaction_session_timeout%3D60000`;
}

// Force a real PrismaClient (not the in-memory proxy) for these tests.
process.env.INTEGRATION_TEST = 'true';
(process.env as any).NODE_ENV = 'test';
process.env.APP_URL = 'http://localhost:3000';
process.env.CRON_SECRET = 'test-cron-secret-at-least-32-characters-long-ok';
process.env.PAYSTACK_SECRET_KEY = 'test-paystack-secret';
process.env.FLUTTERWAVE_SECRET_KEY = 'test-flutterwave-secret';
process.env.FLUTTERWAVE_WEBHOOK_SECRET_HASH = 'test-flutterwave-hash';
process.env.JWT_ACCESS_SECRET = 'test-secret-at-least-32-bytes-long-ok';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-bytes';
process.env.PAYMENT_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.TOTP_ENCRYPTION_KEY = 'b'.repeat(64);
process.env.ENCRYPTION_KEY = 'c'.repeat(64);
process.env.ADMIN_BOOTSTRAP_SECRET = 'test-admin-bootstrap-secret-32-chars';
process.env.RESEND_API_KEY = 'test-resend-key';
process.env.RESEND_FROM_EMAIL = 'test@example.com';
process.env.RENEWAL_LOCK_TIMEOUT_SECONDS = '900';
delete process.env.RENEWAL_RECOVERY_INTERVAL_SECONDS;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

// Make this a module so its top-level `const`s do not collide with the other
// setup script (`tests/integration-setup.ts`) under `module: esnext`.
export {};
