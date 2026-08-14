import { describe, it, expect, vi } from 'vitest';

describe('checkRateLimit fails open', () => {
  it('allows the request when the underlying limiter throws', async () => {
    const { checkRateLimit } = await import('@/lib/ratelimit');
    const brokenLimiter = { limit: vi.fn().mockRejectedValue(new Error('Redis unreachable')) } as any;

    const allowed = await checkRateLimit(brokenLimiter, 'test-ip');
    expect(allowed).toBe(true);
  });

  it('still enforces the limit when the underlying limiter works normally', async () => {
    const { checkRateLimit } = await import('@/lib/ratelimit');
    const workingLimiter = { limit: vi.fn().mockResolvedValue({ success: false }) } as any;

    const allowed = await checkRateLimit(workingLimiter, 'test-ip');
    expect(allowed).toBe(false);
  });
});

describe('getFxRate resilience', () => {
  it('falls back to a live fetch when the cache read fails', async () => {
    vi.doMock('@/lib/redis', () => ({
      redis: {
        get: vi.fn().mockRejectedValue(new Error('cache unavailable')),
        set: vi.fn().mockResolvedValue(undefined),
      },
    }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: 1650 }) }));

    const { getFxRate } = await import('@/lib/fx');
    const rate = await getFxRate('NGN', 'USD');
    expect(rate).toBe(1650);

    vi.unstubAllGlobals();
    vi.doUnmock('@/lib/redis');
    vi.resetModules();
  });

  it('still returns the live rate even when the cache write fails', async () => {
    vi.doMock('@/lib/redis', () => ({
      redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockRejectedValue(new Error('cache write failed')),
      },
    }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: 1650 }) }));

    const { getFxRate } = await import('@/lib/fx');
    const rate = await getFxRate('NGN', 'USD');
    expect(rate).toBe(1650);

    vi.unstubAllGlobals();
    vi.doUnmock('@/lib/redis');
    vi.resetModules();
  });
});
