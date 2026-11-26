import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
vi.mock('@/lib/redis', () => ({
  redis: {
    get: vi.fn(async (key: string) => (store.has(key) ? (store.get(key) as never) : null)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      const k = String(key);
      if (opts?.nx && store.has(k)) return null;
      store.set(k, value);
      return 'OK';
    }),
    del: vi.fn(async () => 1),
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
    eval: vi.fn(async () => [1, 0]),
  },
}));

import { fetchWeather } from '@/lib/analysis/ingestion/weather';

const payload = {
  hourly: {
    time: ['2026-11-26T14:00', '2026-11-26T15:00'],
    temperature_2m: [10, 11],
    precipitation: [0, 1],
    wind_speed_10m: [5, 6],
    weather_code: [0, 61],
  },
};

beforeEach(() => {
  store.clear();
  vi.restoreAllMocks();
});

describe('fetchWeather forecast', () => {
  it('selects the forecast hour matching kickoff', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload } as any)));
    const result = await fetchWeather(1, 2, '2026-11-26T15:00:00.000Z');
    expect(result).toEqual({ temperature: 11, precipitation: 1, windSpeed: 6, condition: 'rain' });
  });

  it('handles UTC date boundary', async () => {
    const p = { hourly: { time: ['2026-11-26T23:00', '2026-11-27T00:00'], temperature_2m: [1,2], precipitation:[0,0], wind_speed_10m:[1,2], weather_code:[0,0] } };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => p } as any)));
    const result = await fetchWeather(1, 2, '2026-11-27T00:00:00.000Z');
    expect(result?.temperature).toBe(2);
  });

  it('returns undefined for invalid kickoff', async () => {
    const result = await fetchWeather(1, 2, 'not-a-date');
    expect(result).toBeUndefined();
  });

  it('returns undefined when forecast hour missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload } as any)));
    const result = await fetchWeather(1, 2, '2026-11-27T00:00:00.000Z');
    expect(result).toBeUndefined();
  });

  it('returns undefined when coordinates missing', async () => {
    const result = await fetchWeather(undefined, 2, '2026-11-26T15:00:00.000Z');
    expect(result).toBeUndefined();
  });

  it('handles HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 } as any)));
    const result = await fetchWeather(1, 2, '2026-11-26T15:00:00.000Z');
    expect(result).toBeUndefined();
  });

  it('handles timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('aborted'); }));
    const result = await fetchWeather(1, 2, '2026-11-26T15:00:00.000Z');
    expect(result).toBeUndefined();
  });

  it('handles malformed response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) } as any)));
    const result = await fetchWeather(1, 2, '2026-11-26T15:00:00.000Z');
    expect(result).toBeUndefined();
  });

  it('caches by kickoff hour', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => payload } as any));
    vi.stubGlobal('fetch', fetchMock);
    await fetchWeather(1, 2, '2026-11-26T14:00:00.000Z');
    await fetchWeather(1, 2, '2026-11-26T14:00:00.000Z');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
