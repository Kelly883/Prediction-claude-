// Runs before every test file. Secrets must be set before modules are imported.
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
