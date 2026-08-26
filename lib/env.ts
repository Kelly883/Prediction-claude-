import { z } from 'zod';

const CoreEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  DIRECT_URL: z.string().url('DIRECT_URL must be a valid URL').optional(),
  CRON_SECRET: z.string().min(32, 'CRON_SECRET must be at least 32 characters'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be >= 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be >= 32 characters'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  SESSION_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(86_400_000),
  RENEWAL_LOCK_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(900),
  FX_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),
});

const OptionalEnvSchema = z.object({
  APP_URL: z.string().optional(),
  PAYSTACK_SECRET_KEY: z.string().optional(),
  FLUTTERWAVE_SECRET_KEY: z.string().optional(),
  FLUTTERWAVE_WEBHOOK_SECRET_HASH: z.string().optional(),
  PAYMENT_TOKEN_ENCRYPTION_KEY: z.string().length(64).optional(),
  TOTP_ENCRYPTION_KEY: z.string().length(64).optional(),
  ENCRYPTION_KEY: z.string().length(64).optional(),
  ADMIN_BOOTSTRAP_SECRET: z.string().min(32).optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
});

export type Env = z.infer<typeof CoreEnvSchema> & z.infer<typeof OptionalEnvSchema>;

let cachedCore: z.infer<typeof CoreEnvSchema> | null = null;

function parseCore(): z.infer<typeof CoreEnvSchema> {
  if (cachedCore && process.env.NODE_ENV !== 'test') return cachedCore;
  const result = CoreEnvSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('\n');
    throw new Error(`Core environment validation failed:\n${missing}`);
  }
  cachedCore = result.data;
  return cachedCore;
}

export function getEnv(): Env {
  const core = parseCore();
  const optional = OptionalEnvSchema.parse(process.env);
  return { ...core, ...optional };
}

export function requireAppUrl(): string {
  const raw = process.env.APP_URL || getEnv().APP_URL || '';
  if (!raw) throw new Error('APP_URL is required');
  if (!/^https?:\/\//i.test(raw)) return `https://${raw}`;
  return raw;
}

export function getBaseUrl(): string {
  const raw = process.env.APP_URL || '';
  if (!raw) return 'http://localhost:3000';
  if (!/^https?:\/\//i.test(raw)) return `https://${raw}`;
  return raw;
}

export function requirePaystack(): void {
  const key = process.env.PAYSTACK_SECRET_KEY || getEnv().PAYSTACK_SECRET_KEY;
  if (!key) throw new Error('PAYSTACK_SECRET_KEY is required for Paystack payments');
}

export function requireFlutterwave(): void {
  const key = process.env.FLUTTERWAVE_SECRET_KEY || getEnv().FLUTTERWAVE_SECRET_KEY;
  const hash = process.env.FLUTTERWAVE_WEBHOOK_SECRET_HASH || getEnv().FLUTTERWAVE_WEBHOOK_SECRET_HASH;
  if (!key) throw new Error('FLUTTERWAVE_SECRET_KEY is required for Flutterwave payments');
  if (!hash) throw new Error('FLUTTERWAVE_WEBHOOK_SECRET_HASH is required for Flutterwave webhooks');
}

export function requirePaymentEncryption(): void {
  const key = process.env.PAYMENT_TOKEN_ENCRYPTION_KEY || getEnv().PAYMENT_TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error('PAYMENT_TOKEN_ENCRYPTION_KEY is required');
}

export function requireEncryption(): void {
  const key = process.env.ENCRYPTION_KEY || getEnv().ENCRYPTION_KEY;
  if (!key) throw new Error('ENCRYPTION_KEY is required');
}

export function requireTotpEncryption(): void {
  const key = process.env.TOTP_ENCRYPTION_KEY || getEnv().TOTP_ENCRYPTION_KEY;
  if (!key) throw new Error('TOTP_ENCRYPTION_KEY is required');
}

export function requireAdminBootstrap(): void {
  const secret = process.env.ADMIN_BOOTSTRAP_SECRET || getEnv().ADMIN_BOOTSTRAP_SECRET;
  if (!secret) throw new Error('ADMIN_BOOTSTRAP_SECRET is required');
}

export function requireEmail(): void {
  const key = process.env.RESEND_API_KEY || getEnv().RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || getEnv().RESEND_FROM_EMAIL;
  if (!key) throw new Error('RESEND_API_KEY is required');
  if (!from) throw new Error('RESEND_FROM_EMAIL is required');
}

export function isProduction(): boolean {
  return getEnv().NODE_ENV === 'production';
}

export function isTest(): boolean {
  return getEnv().NODE_ENV === 'test';
}

export function resetEnvCache() {
  cachedCore = null;
}
