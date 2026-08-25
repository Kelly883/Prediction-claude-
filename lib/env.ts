import { z } from 'zod';

const BaseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url('APP_URL must be a valid URL'),
  CRON_SECRET: z.string().min(32, 'CRON_SECRET must be at least 32 characters'),
  RENEWAL_LOCK_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(900),

  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  DIRECT_URL: z.string().url('DIRECT_URL must be a valid URL').optional(),

  PAYSTACK_SECRET_KEY: z.string().min(1, 'PAYSTACK_SECRET_KEY is required'),
  FLUTTERWAVE_SECRET_KEY: z.string().min(1, 'FLUTTERWAVE_SECRET_KEY is required'),
  FLUTTERWAVE_WEBHOOK_SECRET_HASH: z.string().min(1, 'FLUTTERWAVE_WEBHOOK_SECRET_HASH is required'),
  FX_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be >= 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be >= 32 characters'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  SESSION_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(86_400_000),

  PAYMENT_TOKEN_ENCRYPTION_KEY: z.string().length(64, 'PAYMENT_TOKEN_ENCRYPTION_KEY must be 64 hex characters'),
  TOTP_ENCRYPTION_KEY: z.string().length(64, 'TOTP_ENCRYPTION_KEY must be 64 hex characters'),
  ENCRYPTION_KEY: z.string().length(64, 'ENCRYPTION_KEY must be 64 hex characters'),

  ADMIN_BOOTSTRAP_SECRET: z.string().min(32, 'ADMIN_BOOTSTRAP_SECRET must be >= 32 characters'),

  RESEND_API_KEY: z.string().min(1, 'RESEND_API_KEY is required'),
  RESEND_FROM_EMAIL: z.string().email('RESEND_FROM_EMAIL must be a valid email'),

  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
});

export type Env = z.infer<typeof BaseEnvSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv && process.env.NODE_ENV !== 'test') return cachedEnv;

  const result = BaseEnvSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('\n');
    throw new Error(`Environment validation failed:\n${missing}`);
  }

  cachedEnv = result.data;
  return cachedEnv;
}

export function isProduction(): boolean {
  return getEnv().NODE_ENV === 'production';
}

export function isTest(): boolean {
  return getEnv().NODE_ENV === 'test';
}

export function resetEnvCache() {
  cachedEnv = null;
}
