import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  eval: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
}));

vi.mock('@/lib/redis', () => ({ redis: mocks }));

import { createProviderGuard, positiveIntEnv } from '@/lib/analysis/provider-guard';
import { QuotaExceededError } from '@/lib/analysis/quota';

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  vi.clearAllMocks();
});

describe('positiveIntEnv', () => {
  it('returns the fallback when unset or invalid', () => {
    delete process.env.GUARD_TEST_INT;
    expect(positiveIntEnv('GUARD_TEST_INT', 7)).toBe(7);
    process.env.GUARD_TEST_INT = 'abc';
    expect(positiveIntEnv('GUARD_TEST_INT', 7)).toBe(7);
    process.env.GUARD_TEST_INT = '0';
    expect(positiveIntEnv('GUARD_TEST_INT', 7)).toBe(7);
    process.env.GUARD_TEST_INT = '4';
    expect(positiveIntEnv('GUARD_TEST_INT', 7)).toBe(4);
    delete process.env.GUARD_TEST_INT;
  });
});

describe('createProviderGuard', () => {
  it('runs the wrapped function when quota is available', async () => {
    // football-data has no hard cap -> quota always allows.
    const guard = createProviderGuard('football-data', 5);
    const result = await guard(async () => 'ok');
    expect(result).toBe('ok');
  });

  it('throws QuotaExceededError and skips the call when the cap is reached', async () => {
    mocks.eval.mockResolvedValue([0, 100]); // api-football exhausted
    const guard = createProviderGuard('api-football', 5);
    const fn = vi.fn(async () => 'should-not-run');

    await expect(guard(fn)).rejects.toBeInstanceOf(QuotaExceededError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('bounds concurrency of guarded calls', async () => {
    const guard = createProviderGuard('football-data', 2); // no cap; tests concurrency only
    let running = 0;
    let peak = 0;
    const task = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await tick();
      running -= 1;
    };
    await Promise.all(Array.from({ length: 8 }, () => guard(task)));
    expect(peak).toBeLessThanOrEqual(2);
  });
});