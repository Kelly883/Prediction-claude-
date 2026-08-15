import { Ratelimit } from '@upstash/ratelimit';
import { redis } from './redis';

// Design doc Section 7: rate limit login, password reset, CSV upload,
// predictions API. Each limiter below is a separate sliding window so a
// burst on one endpoint doesn't consume another endpoint's budget.
export const authLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, '60 s'),
  prefix: 'rl:auth',
});

export const csvUploadLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '60 s'),
  prefix: 'rl:csv',
});

export const imageUploadLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, '60 s'),
  prefix: 'rl:img_upload',
});

export const defaultLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, '60 s'),
  prefix: 'rl:default',
});

/**
 * Returns whether the request is allowed. Deliberately fails OPEN, not
 * closed: rate limiting is defense-in-depth against abuse, not the primary
 * security boundary (auth/RBAC/validation are). If Upstash is unreachable
 * or misconfigured, the correct behavior is "skip rate limiting for now,"
 * not "take down registration, login, and every other rate-limited route
 * along with it" — which is exactly what happened in production before
 * this fix (an unhandled error from the Redis client crashed the whole
 * request with a 500, on every single auth attempt).
 */
export async function checkRateLimit(limiter: Ratelimit, identifier: string): Promise<boolean> {
  try {
    const { success } = await limiter.limit(identifier);
    return success;
  } catch (err) {
    console.error('Rate limiter unavailable, failing open (request allowed):', err);
    return true;
  }
}
