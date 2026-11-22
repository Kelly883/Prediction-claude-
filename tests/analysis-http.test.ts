import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CircuitOpenError,
  NonRetryableError,
  circuitAllows,
  circuitState,
  fetchWithRetry,
} from '@/lib/analysis/http';

function response(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null } as unknown as Headers,
    json: async () => body,
  } as unknown as Response;
}

// Small backoff so retry tests run fast without real delays.
const FAST = { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 2 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchWithRetry', () => {
  it('returns the response on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(200, { ok: 1 })));
    const res = await fetchWithRetry('t-success', 'https://x.test/ok', {}, FAST);
    expect(res.status).toBe(200);
  });

  it('retries a 5xx then succeeds on the next attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(500))
      .mockResolvedValueOnce(response(200, { ok: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchWithRetry('t-retry', 'https://x.test/flaky', {}, FAST);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a non-retryable 4xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(404));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fetchWithRetry('t-404', 'https://x.test/missing', {}, FAST),
    ).rejects.toBeInstanceOf(NonRetryableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('fetchWithRetry circuit breaker', () => {
  it('opens the circuit after repeated 5xx failures and fails fast with CircuitOpenError', async () => {
    // maxRetries 0 => one attempt per call; 5 consecutive failures opens it.
    const opts = { maxRetries: 0 };
    const fetchMock = vi.fn().mockResolvedValue(response(500));
    vi.stubGlobal('fetch', fetchMock);

    for (let i = 0; i < 5; i += 1) {
      await expect(
        fetchWithRetry('t-5xx', 'https://x.test/down', {}, opts),
      ).rejects.toBeInstanceOf(Error);
    }
    expect(circuitState('t-5xx').open).toBe(true);

    const callsBefore = fetchMock.mock.calls.length;
    await expect(
      fetchWithRetry('t-5xx', 'https://x.test/down', {}, opts),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    // No network call was made while the circuit was open.
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it('opens the circuit after repeated 429 rate limits', async () => {
    const opts = { maxRetries: 0 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(429)));
    for (let i = 0; i < 5; i += 1) {
      await expect(
        fetchWithRetry('t-429', 'https://x.test/limited', {}, opts),
      ).rejects.toBeInstanceOf(NonRetryableError);
    }
    expect(circuitState('t-429').open).toBe(true);
    await expect(
      fetchWithRetry('t-429', 'https://x.test/limited', {}, opts),
    ).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it('does NOT open the circuit on non-retryable 4xx (per-request errors)', async () => {
    const opts = { maxRetries: 0 };
    const fetchMock = vi.fn().mockResolvedValue(response(404));
    vi.stubGlobal('fetch', fetchMock);
    // Many 404s should never trip the breaker.
    for (let i = 0; i < 10; i += 1) {
      await expect(
        fetchWithRetry('t-many-404', 'https://x.test/gone', {}, opts),
      ).rejects.toBeInstanceOf(NonRetryableError);
    }
    expect(circuitState('t-many-404').open).toBe(false);
    expect(circuitAllows('t-many-404')).toBe(true);
  });

  it('closes the circuit after a subsequent success (half-open recovery)', async () => {
    const opts = { maxRetries: 0 };
    const fetchMock = vi.fn().mockResolvedValue(response(500));
    vi.stubGlobal('fetch', fetchMock);
    for (let i = 0; i < 5; i += 1) {
      await expect(
        fetchWithRetry('t-recover', 'https://x.test/down', {}, opts),
      ).rejects.toBeInstanceOf(Error);
    }
    expect(circuitState('t-recover').open).toBe(true);

    // Simulate the open window elapsing: half-open trial call succeeds.
    // We reach the trial path by advancing time past the open window.
    const originalNow = Date.now;
    const future = originalNow() + 120_000;
    Date.now = () => future;
    try {
      fetchMock.mockResolvedValue(response(200));
      const res = await fetchWithRetry('t-recover', 'https://x.test/up', {}, opts);
      expect(res.status).toBe(200);
      expect(circuitState('t-recover').open).toBe(false);
    } finally {
      Date.now = originalNow;
    }
  });
});