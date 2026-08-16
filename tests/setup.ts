// Runs before every test file. Secrets must be set before modules are imported.
(process.env as any).NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-secret-at-least-32-bytes-long-ok';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-bytes';
process.env.PAYMENT_TOKEN_ENCRYPTION_KEY = 'test-payment-encryption-key-32-bytes-ok!';
process.env.TOTP_ENCRYPTION_KEY = 'test-totp-encryption-key-32-bytes-long-ok!';
process.env.ENCRYPTION_KEY = 'test-fallback-encryption-key-32-bytes-ok!';
