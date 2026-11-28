import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const REQUIRED_CORE = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  CRON_SECRET: 'test-cron-secret-at-least-32-characters-long-ok',
  JWT_ACCESS_SECRET: 'test-secret-at-least-32-bytes-long-ok',
  JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-bytes',
};

const VALID_OPTIONAL = {
  PAYMENT_TOKEN_ENCRYPTION_KEY: 'a'.repeat(64),
  TOTP_ENCRYPTION_KEY: 'b'.repeat(64),
  ENCRYPTION_KEY: 'c'.repeat(64),
  ADMIN_BOOTSTRAP_SECRET: 'test-admin-bootstrap-secret-32-chars',
  RESEND_API_KEY: 'test-resend-key',
  RESEND_FROM_EMAIL: 'test@example.com',
  DIRECT_URL: 'postgresql://test:test@localhost:5432/test',
  APP_URL: 'http://localhost:3000',
  PAYSTACK_SECRET_KEY: 'test-paystack-secret',
  FLUTTERWAVE_SECRET_KEY: 'test-flutterwave-secret',
  FLUTTERWAVE_WEBHOOK_SECRET_HASH: 'test-flutterwave-hash',
  S3_ACCESS_KEY_ID: 'test-key',
  S3_BUCKET: 'test-bucket',
  S3_ENDPOINT: 'https://test.s3.amazonaws.com',
  S3_REGION: 'us-east-1',
  S3_SECRET_ACCESS_KEY: 'test-secret',
  API_FOOTBALL_KEY: 'test-api-football-key',
  FOOTBALL_DATA_API_KEY: 'test-football-data-key',
  FOOTBALL_API_TIMEOUT_MS: '5000',
  FOOTBALL_CACHE_TTL_SECONDS: '3600',
  PROVIDER_RPS: '10',
  PROVIDER_RPM: '100',
  PROVIDER_MAX_WAIT_MS: '5000',
  PROVIDER_MAX_SLEEP_MS: '1000',
  FOOTBALL_DATA_RPS: '5',
  FOOTBALL_DATA_RPM: '50',
  FOOTBALL_DATA_MAX_WAIT_MS: '5000',
  FOOTBALL_DATA_MAX_SLEEP_MS: '1000',
  PROVIDER_ANALYSIS_MAX_RUNTIME_MS: '30000',
  PROVIDER_ANALYSIS_BATCH_SIZE: '10',
  PROVIDER_QUOTA_WARNING_THRESHOLD: '0.5',
  PROVIDER_QUOTA_CRITICAL_THRESHOLD: '0.8',
  PROVIDER_QUOTA_STOP_THRESHOLD: '0.95',
  PROVIDER_QUOTA_FRESHNESS_SECONDS: '300',
  PROVIDER_QUOTA_SNAPSHOT_TTL_SECONDS: '600',
  PROVIDER_QUOTA_UNKNOWN_POLICY: 'warn',
  PROVIDER_ENRICHMENT_CONCURRENCY: '3',
  PROVIDER_SINGLE_FLIGHT_LOCK_TTL_MS: '1000',
  PROVIDER_SINGLE_FLIGHT_WAIT_MS: '100',
  PROVIDER_SINGLE_FLIGHT_POLL_MS: '50',
  PROVIDER_CACHE_TTL_DEFAULT_SECONDS: '300',
  PROVIDER_CACHE_TTL_FIXTURES_SECONDS: '60',
  PROVIDER_CACHE_TTL_TEAM_STATS_SECONDS: '300',
  PROVIDER_CACHE_TTL_H2H_SECONDS: '300',
  PROVIDER_CACHE_TTL_INJURIES_SECONDS: '300',
  PROVIDER_CACHE_TTL_ODDS_SECONDS: '60',
  PROVIDER_CACHE_TTL_SCORERS_SECONDS: '300',
  PROVIDER_CACHE_TTL_WEATHER_SECONDS: '300',
};

function setEnvAll(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

function resetAllEnv() {
  setEnvAll({ ...REQUIRED_CORE, ...VALID_OPTIONAL });
}

describe('Environment validation', () => {
  beforeEach(() => {
    vi.resetModules();
    resetAllEnv();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('RESEND_FROM_EMAIL validation', () => {
    it('accepts undefined RESEND_FROM_EMAIL', async () => {
      delete process.env.RESEND_FROM_EMAIL;
      const { getEnv } = await import('@/lib/env');
      const env = getEnv();
      expect(env.RESEND_FROM_EMAIL).toBeUndefined();
    });

    it('normalizes empty string RESEND_FROM_EMAIL to undefined', async () => {
      process.env.RESEND_FROM_EMAIL = '';
      const { getEnv } = await import('@/lib/env');
      const env = getEnv();
      expect(env.RESEND_FROM_EMAIL).toBeUndefined();
    });

    it('accepts valid email address', async () => {
      process.env.RESEND_FROM_EMAIL = 'test@example.com';
      const { getEnv } = await import('@/lib/env');
      const env = getEnv();
      expect(env.RESEND_FROM_EMAIL).toBe('test@example.com');
    });

    it('rejects invalid non-empty email address', async () => {
      process.env.RESEND_FROM_EMAIL = 'not-an-email';
      await expect(async () => {
        const { getEnv } = await import('@/lib/env');
        getEnv();
      }).rejects.toThrow('RESEND_FROM_EMAIL');
    });
  });

  describe('Other optional fields with validation', () => {
    it('normalizes empty string PAYMENT_TOKEN_ENCRYPTION_KEY to undefined', async () => {
      process.env.PAYMENT_TOKEN_ENCRYPTION_KEY = '';
      const { getEnv } = await import('@/lib/env');
      const env = getEnv();
      expect(env.PAYMENT_TOKEN_ENCRYPTION_KEY).toBeUndefined();
    });

    it('normalizes empty string TOTP_ENCRYPTION_KEY to undefined', async () => {
      process.env.TOTP_ENCRYPTION_KEY = '';
      const { getEnv } = await import('@/lib/env');
      const env = getEnv();
      expect(env.TOTP_ENCRYPTION_KEY).toBeUndefined();
    });

    it('normalizes empty string ENCRYPTION_KEY to undefined', async () => {
      process.env.ENCRYPTION_KEY = '';
      const { getEnv } = await import('@/lib/env');
      const env = getEnv();
      expect(env.ENCRYPTION_KEY).toBeUndefined();
    });

    it('normalizes empty string ADMIN_BOOTSTRAP_SECRET to undefined', async () => {
      process.env.ADMIN_BOOTSTRAP_SECRET = '';
      const { getEnv } = await import('@/lib/env');
      const env = getEnv();
      expect(env.ADMIN_BOOTSTRAP_SECRET).toBeUndefined();
    });

    it('rejects invalid non-empty PAYMENT_TOKEN_ENCRYPTION_KEY (wrong length)', async () => {
      process.env.PAYMENT_TOKEN_ENCRYPTION_KEY = 'short';
      await expect(async () => {
        const { getEnv } = await import('@/lib/env');
        getEnv();
      }).rejects.toThrow('PAYMENT_TOKEN_ENCRYPTION_KEY');
    });

    it('rejects invalid non-empty ADMIN_BOOTSTRAP_SECRET (too short)', async () => {
      process.env.ADMIN_BOOTSTRAP_SECRET = 'short';
      await expect(async () => {
        const { getEnv } = await import('@/lib/env');
        getEnv();
      }).rejects.toThrow('ADMIN_BOOTSTRAP_SECRET');
    });
  });

  describe('Authentication with email config absent', () => {
    it('getEnv() succeeds when RESEND_FROM_EMAIL is undefined', async () => {
      delete process.env.RESEND_FROM_EMAIL;
      delete process.env.RESEND_API_KEY;
      const { getEnv } = await import('@/lib/env');
      expect(() => getEnv()).not.toThrow();
    });

    it('getEnv() succeeds when RESEND_FROM_EMAIL is empty string', async () => {
      process.env.RESEND_FROM_EMAIL = '';
      process.env.RESEND_API_KEY = '';
      const { getEnv } = await import('@/lib/env');
      expect(() => getEnv()).not.toThrow();
    });

    it('auth token operations work without email config', async () => {
      process.env.RESEND_FROM_EMAIL = '';
      process.env.RESEND_API_KEY = '';
      const { issueAccessToken, verifyAccessToken, issueRefreshToken, verifyRefreshToken } = await import('@/lib/auth');

      const accessToken = await issueAccessToken({ sub: 'user-1', role: 'admin' });
      const payload = await verifyAccessToken(accessToken);
      expect(payload).toEqual({ sub: 'user-1', role: 'admin' });

      const refreshToken = await issueRefreshToken('user-42');
      const refreshPayload = await verifyRefreshToken(refreshToken);
      expect(refreshPayload?.sub).toBe('user-42');
    });
  });

  describe('Email-dependent functionality with email config absent', () => {
    it('requireEmail() throws when RESEND_API_KEY is missing', async () => {
      delete process.env.RESEND_API_KEY;
      process.env.RESEND_FROM_EMAIL = 'test@example.com';
      const { requireEmail } = await import('@/lib/env');
      expect(() => requireEmail()).toThrow('RESEND_API_KEY is required');
    });

    it('requireEmail() throws when RESEND_FROM_EMAIL is missing', async () => {
      process.env.RESEND_API_KEY = 'test-key';
      delete process.env.RESEND_FROM_EMAIL;
      const { requireEmail } = await import('@/lib/env');
      expect(() => requireEmail()).toThrow('RESEND_FROM_EMAIL is required');
    });

    it('requireEmail() throws when RESEND_FROM_EMAIL is empty string', async () => {
      process.env.RESEND_API_KEY = 'test-key';
      process.env.RESEND_FROM_EMAIL = '';
      const { requireEmail } = await import('@/lib/env');
      expect(() => requireEmail()).toThrow('RESEND_FROM_EMAIL is required');
    });

    it('requireEmail() succeeds when both are configured', async () => {
      process.env.RESEND_API_KEY = 'test-key';
      process.env.RESEND_FROM_EMAIL = 'test@example.com';
      const { requireEmail } = await import('@/lib/env');
      expect(() => requireEmail()).not.toThrow();
    });
  });
});