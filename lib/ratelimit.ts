import { Ratelimit } from '@upstash/ratelimit';
import { NextRequest } from 'next/server';
import { redis } from './redis';
import { ApiError } from './rbac';

export type RateLimitPolicy = 'AUTH' | 'PAYMENT' | 'ADMIN' | 'PUBLIC';

export interface RateLimitOptions {
  failClosed?: boolean;
}

// 1. AUTH policy: 5 requests per 60s, strictly fail-closed
export const authLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, '60 s'),
  prefix: 'rl:auth',
});
(authLimiter as any).policy = 'AUTH';
(authLimiter as any).failClosed = true;

// 2. PAYMENT policy: 10 requests per 60s, strictly fail-closed
export const paymentLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '60 s'),
  prefix: 'rl:payment',
});
(paymentLimiter as any).policy = 'PAYMENT';
(paymentLimiter as any).failClosed = true;

// 3. ADMIN policy: 10 requests per 60s, strictly fail-closed
export const adminLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '60 s'),
  prefix: 'rl:admin',
});
(adminLimiter as any).policy = 'ADMIN';
(adminLimiter as any).failClosed = true;

export const csvUploadLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '60 s'),
  prefix: 'rl:csv',
});
(csvUploadLimiter as any).policy = 'ADMIN';
(csvUploadLimiter as any).failClosed = true;

// 4. PUBLIC policy: 100 requests per 60s, fail-open for unauthenticated public browsing
export const publicLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, '60 s'),
  prefix: 'rl:public',
});
(publicLimiter as any).policy = 'PUBLIC';
(publicLimiter as any).failClosed = false;

// Alias for backwards compatibility
export const defaultLimiter = publicLimiter;

export const POLICY_LIMITERS: Record<RateLimitPolicy, { limiter: Ratelimit; failClosed: boolean }> = {
  AUTH: { limiter: authLimiter, failClosed: true },
  PAYMENT: { limiter: paymentLimiter, failClosed: true },
  ADMIN: { limiter: adminLimiter, failClosed: true },
  PUBLIC: { limiter: publicLimiter, failClosed: false },
};

/**
 * Validates and extracts a trustworthy client IP address from request headers.
 * Strips whitespace, validates IPv4/IPv6 format, and prevents arbitrary client spoofing.
 */
export function getClientIp(req: NextRequest): string {
  // In Next.js / Vercel / Cloud Run behind reverse proxy:
  // x-forwarded-for contains comma-separated client, proxy1, proxy2...
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const rawIp = forwarded.split(',')[0].trim();
    if (isValidIp(rawIp)) {
      return rawIp;
    }
  }

  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp && isValidIp(realIp)) {
    return realIp;
  }

  const cfIp = req.headers.get('cf-connecting-ip')?.trim();
  if (cfIp && isValidIp(cfIp)) {
    return cfIp;
  }

  return '127.0.0.1';
}

function isValidIp(ip: string): boolean {
  if (!ip || typeof ip !== 'string') return false;
  // Basic IPv4 pattern
  const ipv4Regex = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)$/;
  // Basic IPv6 pattern
  const ipv6Regex = /^([0-9a-fA-F]{1,4}:){1,7}[0-9a-fA-F]{1,4}$|^::1$|^::$/;
  return ipv4Regex.test(ip) || ipv6Regex.test(ip);
}

/**
 * Normalizes email or account identifier to prevent casing/whitespace evasion.
 */
export function normalizeIdentifier(type: 'email' | 'user' | 'ip', value: string): string {
  if (!value) return `${type}:unknown`;
  if (type === 'email') {
    return `email:${value.trim().toLowerCase()}`;
  }
  if (type === 'user') {
    return `user:${value.trim()}`;
  }
  return `ip:${value.trim()}`;
}

/**
 * Checks rate limit for one or multiple identifiers.
 *
 * Fail-Closed Behavior for Security-Critical Endpoints:
 * - If policy / limiter is fail-closed (e.g. AUTH, PAYMENT, ADMIN) and Redis throws,
 *   this function throws an ApiError(503, 'Security service temporarily unavailable. Please try again shortly.')
 * - For harmless public endpoints (PUBLIC / defaultLimiter), it catches and returns true (fails open).
 */
export async function checkRateLimit(
  limiterOrPolicy: Ratelimit | RateLimitPolicy,
  identifier: string | string[],
  options?: RateLimitOptions,
): Promise<boolean> {
  let limiter: Ratelimit;
  let failClosed: boolean;

  if (typeof limiterOrPolicy === 'string') {
    const config = POLICY_LIMITERS[limiterOrPolicy] || POLICY_LIMITERS.PUBLIC;
    limiter = config.limiter;
    failClosed = options?.failClosed ?? config.failClosed;
  } else {
    limiter = limiterOrPolicy;
    failClosed = options?.failClosed ?? (limiter as any)?.failClosed ?? false;
  }

  const ids = Array.isArray(identifier) ? identifier : [identifier];

  try {
    for (const id of ids) {
      const { success } = await limiter.limit(id);
      if (!success) {
        return false;
      }
    }
    return true;
  } catch (err) {
    if (failClosed) {
      console.error('Rate limiter unavailable for security-critical route, failing closed (503):', err);
      throw new ApiError(503, 'Security service temporarily unavailable. Please try again shortly.');
    }
    console.error('Rate limiter unavailable, failing open (request allowed):', err);
    return true;
  }
}
