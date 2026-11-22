import { describe, expect, it, vi } from 'vitest';

describe('redis client in tests', () => {
  it('uses the in-memory store even when Upstash credentials are present', async () => {
    const prevUrl = process.env.UPSTASH_REDIS_REST_URL;
    const prevToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
    const fetchSpy = vi.fn(() => {
      throw new Error('Redis must not use fetch in tests');
    });
    vi.stubGlobal('fetch', fetchSpy);
    vi.resetModules();

    try {
      const { redis } = await import('@/lib/redis');
      await redis.set('dev-key', 'value', { ex: 60 });
      expect(await redis.get('dev-key')).toBe('value');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      if (prevUrl) process.env.UPSTASH_REDIS_REST_URL = prevUrl;
      else delete process.env.UPSTASH_REDIS_REST_URL;
      if (prevToken) process.env.UPSTASH_REDIS_REST_TOKEN = prevToken;
      else delete process.env.UPSTASH_REDIS_REST_TOKEN;
      vi.resetModules();
    }
  });
});
