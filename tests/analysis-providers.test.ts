import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  apiFootballLeagueId,
  footballDataCompetitionCode,
  leagueMapping,
} from '@/lib/api/provider-mapping';
import {
  ProviderAuthError,
  ProviderError,
  ProviderQuotaExhaustedError,
  ProviderRateLimitError,
  parseRetryAfter,
  providerErrorFromResponse,
  withBoundedRetry,
} from '@/lib/api/retry';

describe('provider mapping', () => {
  it('maps internal codes to authoritative provider identifiers', () => {
    expect(apiFootballLeagueId('PL')).toBe(39);
    expect(apiFootballLeagueId('LIB')).toBe(262);
    expect(footballDataCompetitionCode('ERE')).toBe('DED');
    expect(footballDataCompetitionCode('BRA')).toBe('BSA');
  });

  it('renames LIB to Liga MX per the authoritative product decision', () => {
    expect(leagueMapping('LIB')?.name).toBe('Liga MX');
  });

  it('marks Football-Data leagues the free plan does not cover', () => {
    expect(footballDataCompetitionCode('PL')).toBe('PL');
    expect(footballDataCompetitionCode('LIB')).toBeUndefined();
    expect(footballDataCompetitionCode('J1')).toBeUndefined();
  });

  it('asserts every product league has an API-Football id', () => {
    const codes = ['PL', 'PD', 'BL1', 'SA', 'FL1', 'PPL', 'ERE', 'CL', 'EL', 'ECL', 'BL2', 'PD2', 'SA2', 'FL2', 'ELC', 'MLS', 'LIB', 'J1', 'ARG', 'BRA'];
    for (const code of codes) {
      expect(apiFootballLeagueId(code), `${code} must have an API-Football id`).toBeTypeOf('number');
    }
  });
});

describe('retry utility', () => {
  it('parses Retry-After as seconds and HTTP-date', () => {
    expect(parseRetryAfter('120')).toBe(120);
    const future = new Date(Date.now() + 30_000).toUTCString();
    const seconds = parseRetryAfter(future);
    expect(seconds).toBeGreaterThan(20);
    expect(seconds).toBeLessThanOrEqual(30);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('not-a-date')).toBeUndefined();
  });

  it('retries recoverable failures then succeeds', async () => {
    let attempts = 0;
    const sleep = vi.fn(async () => {});
    const result = await withBoundedRetry('test', async () => {
      attempts += 1;
      if (attempts < 3) throw new ProviderError('boom', { provider: 'api-football', recoverable: true });
      return 'ok';
    }, { retries: 5, sleep });

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('uses exponential backoff capped at maxDelayMs', async () => {
    const delays: number[] = [];
    const sleep = vi.fn(async (ms: number) => { delays.push(ms); });
    const attempt = vi.fn(async () => {
      throw new ProviderError('boom', { provider: 'api-football', recoverable: true });
    });

    await expect(withBoundedRetry('test', attempt, { retries: 5, baseDelayMs: 100, maxDelayMs: 500, sleep })).rejects.toThrow('boom');

    expect(delays).toEqual([100, 200, 400, 500, 500]);
  });

  it('does not retry non-recoverable failures', async () => {
    const attempt = vi.fn(async () => {
      throw new ProviderQuotaExhaustedError('api-football', 'quota gone');
    });
    const sleep = vi.fn(async () => {});

    await expect(withBoundedRetry('test', attempt, { retries: 5, sleep })).rejects.toBeInstanceOf(ProviderQuotaExhaustedError);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('honours Retry-After on 429', async () => {
    const delays: number[] = [];
    const sleep = vi.fn(async (ms: number) => { delays.push(ms); });
    let attempts = 0;
    await withBoundedRetry('test', async () => {
      attempts += 1;
      if (attempts === 1) throw new ProviderRateLimitError('api-football', 'slow down', 7);
      return 'ok';
    }, { retries: 3, baseDelayMs: 10, sleep });

    expect(delays).toEqual([7000]);
  });
});

describe('provider error classification', () => {
  it('classifies 429 quota exhaustion as non-recoverable', () => {
    const err = providerErrorFromResponse('api-football', 429, 'You have reached the request limit for the day');
    expect(err).toBeInstanceOf(ProviderQuotaExhaustedError);
    expect(err.recoverable).toBe(false);
  });

  it('classifies 429 throttling as recoverable rate limit', () => {
    const err = providerErrorFromResponse('football-data', 429, 'too many requests', '30');
    expect(err).toBeInstanceOf(ProviderRateLimitError);
    expect((err as ProviderRateLimitError).retryAfterSeconds).toBe(30);
  });

  it('classifies auth failures as non-recoverable', () => {
    const err = providerErrorFromResponse('football-data', 401, 'unauthorized');
    expect(err).toBeInstanceOf(ProviderAuthError);
    expect(err.recoverable).toBe(false);
  });

  it('classifies 5xx as recoverable and 4xx as non-recoverable', () => {
    expect(providerErrorFromResponse('api-football', 503, 'down').recoverable).toBe(true);
    expect(providerErrorFromResponse('api-football', 400, 'bad request').recoverable).toBe(false);
  });
});

describe('provider adapter guardrails', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('skips API-Football codes that have no mapping without calling the provider', async () => {
    const { fetchApiFootballFixtures } = await import('@/lib/api/football-api');
    await expect(fetchApiFootballFixtures(['ZZ'], '2026-11-21', '2026-11-23')).rejects.toThrow('API-Football fixtures unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not call Football-Data for leagues outside its coverage', async () => {
    const { fetchFootballDataFixtures } = await import('@/lib/api/football-data');
    await expect(fetchFootballDataFixtures(['LIB'], '2026-11-21', '2026-11-23')).rejects.toThrow('Football-Data fixtures unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries a Football-Data 429 and succeeds when the quota is not exhausted', async () => {
    process.env.PROVIDER_MAX_RETRIES = '2';
    process.env.PROVIDER_RETRY_BASE_MS = '0';
    try {
      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: { get: () => null },
          text: async () => 'rate limited',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ matches: [] }),
        });

      const { fetchFootballDataFixtures } = await import('@/lib/api/football-data');
      const fixtures = await fetchFootballDataFixtures(['PL'], '2026-11-21', '2026-11-23');

      expect(fixtures).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      process.env.PROVIDER_MAX_RETRIES = '0';
      process.env.PROVIDER_RETRY_BASE_MS = '0';
    }
  });
});
