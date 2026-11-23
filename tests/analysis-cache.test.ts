import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory redis stub shared across this test file.
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

import { cachedProviderFetch } from '@/lib/analysis/ingestion/cache';

beforeEach(() => {
  store.clear();
});

describe('cachedProviderFetch single-flight', () => {
  it('loads only once for concurrent callers sharing a key', async () => {
    let calls = 0;
    const loader = async () => {
      calls += 1;
      // Yield so concurrent callers overlap while the load is in flight.
      await new Promise((r) => setTimeout(r, 10));
      return { value: 42 };
    };

    const [a, b, c] = await Promise.all([
      cachedProviderFetch('sf-key', loader),
      cachedProviderFetch('sf-key', loader),
      cachedProviderFetch('sf-key', loader),
    ]);

    expect(calls).toBe(1);
    expect(a).toEqual({ value: 42 });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('serves a sequential call from cache without re-loading', async () => {
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return calls;
    };

    const first = await cachedProviderFetch('seq-key', loader);
    const second = await cachedProviderFetch('seq-key', loader);

    expect(calls).toBe(1);
    expect(first).toBe(1);
    expect(second).toBe(1);
  });

  it('does not share loads across different keys', async () => {
    let calls = 0;
    const loader = async () => {
      const n = ++calls;
      await new Promise((r) => setTimeout(r, 5));
      return n;
    };

    const [a, b] = await Promise.all([
      cachedProviderFetch('key-a', loader),
      cachedProviderFetch('key-b', loader),
    ]);

    expect(calls).toBe(2);
    expect(new Set([a, b]).size).toBe(2);
  });

  it('propagates the loader error when there is no cached value', async () => {
    await expect(
      cachedProviderFetch('missing-key', async () => {
        throw new Error('provider down');
      }),
    ).rejects.toThrow('provider down');
  });
});