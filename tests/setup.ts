// Runs before every test file. Secrets must be set before modules are imported.
import { vi } from 'vitest';
(process.env as any).NODE_ENV = 'test';
process.env.APP_URL = 'http://localhost:3000';
process.env.CRON_SECRET = 'test-cron-secret-at-least-32-characters-long-ok';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.DIRECT_URL = 'postgresql://test:test@localhost:5432/test';
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
process.env.API_FOOTBALL_KEY = 'test-api-football-key';
process.env.FOOTBALL_DATA_API_KEY = 'test-football-data-key';
// Tests must never construct a real Upstash client. If UPSTASH_REDIS_REST_* are
// present in the ambient environment (the CI build job exports dummy values for
// `next build`), lib/redis.ts would build a live client: it shares the stubbed
// global `fetch`, so it corrupts provider fetch mocks and attempts real DNS
// lookups. Clearing them here keeps the suite on the in-memory store — the
// behaviour the tests are written against — independent of the caller's env.
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
// Keep provider retries off by default in tests so failures are deterministic
// and fast; retry behaviour is exercised explicitly in retry unit tests.
process.env.PROVIDER_MAX_RETRIES = '0';
process.env.PROVIDER_RETRY_BASE_MS = '0';
// Keep the provider circuit breaker from tripping during ordinary adapter tests;
// the breaker's own suite overrides this threshold per test.
process.env.PROVIDER_CIRCUIT_THRESHOLD = '100';

// Clear the module registry between test files so that vi.mock() factories
// registered by one test file cannot leak into another via module caching.
// This ensures each test file gets its own isolated mocks for @/lib/prisma
// and other mocked modules, preventing cross-file mock pollution.
vi.resetModules();
