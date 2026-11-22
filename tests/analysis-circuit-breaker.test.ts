import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ProviderCircuitOpenError,
  assertProviderAvailable,
  isProviderCircuitOpen,
  recordProviderFailure,
  recordProviderSuccess,
} from '@/lib/api/circuit-breaker';

describe('provider circuit breaker', () => {
  beforeEach(async () => {
    process.env.PROVIDER_CIRCUIT_THRESHOLD = '3';
    process.env.PROVIDER_CIRCUIT_COOLDOWN_SECONDS = '1';
    await recordProviderSuccess('api-football');
    await recordProviderSuccess('football-data');
  });

  it('stays closed below the failure threshold', async () => {
    await recordProviderFailure('api-football');
    await recordProviderFailure('api-football');

    expect(await isProviderCircuitOpen('api-football')).toBe(false);
    await expect(assertProviderAvailable('api-football')).resolves.toBeUndefined();
  });

  it('opens at the threshold and short-circuits subsequent calls', async () => {
    for (let i = 0; i < 3; i += 1) await recordProviderFailure('api-football');

    expect(await isProviderCircuitOpen('api-football')).toBe(true);
    await expect(assertProviderAvailable('api-football')).rejects.toBeInstanceOf(ProviderCircuitOpenError);
  });

  it('resets after a successful request', async () => {
    for (let i = 0; i < 3; i += 1) await recordProviderFailure('api-football');
    await recordProviderSuccess('api-football');

    expect(await isProviderCircuitOpen('api-football')).toBe(false);
    await expect(assertProviderAvailable('api-football')).resolves.toBeUndefined();
  });

  it('isolates the circuit per provider', async () => {
    for (let i = 0; i < 3; i += 1) await recordProviderFailure('api-football');

    expect(await isProviderCircuitOpen('football-data')).toBe(false);
    await expect(assertProviderAvailable('football-data')).resolves.toBeUndefined();
  });
});

describe('redis production fail-closed', () => {
  it('refuses to fall back to in-memory Redis in production', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevUrl = process.env.UPSTASH_REDIS_REST_URL;
    const prevToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    vi.resetModules();
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    try {
      const mod = await import('@/lib/redis');
      expect(mod.isDistributedRedisConfigured()).toBe(false);
      expect(() => mod.redis.get('any-key')).toThrow(/Distributed Redis is required in production/);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prevNodeEnv;
      if (prevUrl) process.env.UPSTASH_REDIS_REST_URL = prevUrl;
      if (prevToken) process.env.UPSTASH_REDIS_REST_TOKEN = prevToken;
      vi.resetModules();
    }
  });

  it('uses the in-memory store outside production', async () => {
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
      const mod = await import('@/lib/redis');
      await mod.redis.set('dev-key', 'value', { ex: 60 });
      expect(await mod.redis.get('dev-key')).toBe('value');
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
