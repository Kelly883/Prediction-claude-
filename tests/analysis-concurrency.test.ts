import { describe, expect, it } from 'vitest';
import { createConcurrencyLimiter } from '@/lib/analysis/concurrency';

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe('createConcurrencyLimiter', () => {
  it('rejects a non-positive limit', () => {
    expect(() => createConcurrencyLimiter(0)).toThrow();
    expect(() => createConcurrencyLimiter(-1)).toThrow();
  });

  it('never exceeds the max concurrent executions', async () => {
    const limiter = createConcurrencyLimiter(3);
    let running = 0;
    let peak = 0;

    const task = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await tick();
      running -= 1;
      return 'done';
    };

    const results = await Promise.all(
      Array.from({ length: 20 }, () => limiter.run(task)),
    );

    expect(peak).toBeLessThanOrEqual(3);
    expect(results.every((r) => r === 'done')).toBe(true);
    expect(limiter.active).toBe(0);
  });

  it('runs queued tasks in FIFO order', async () => {
    const limiter = createConcurrencyLimiter(1);
    const order: number[] = [];

    const tasks = Array.from({ length: 5 }, (_, i) =>
      limiter.run(async () => {
        order.push(i);
        await tick();
        return i;
      }),
    );
    await Promise.all(tasks);

    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  it('propagates errors and releases the permit', async () => {
    const limiter = createConcurrencyLimiter(2);
    await expect(
      limiter.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // The permit must have been released, so new work still runs.
    const result = await limiter.run(async () => 'ok');
    expect(result).toBe('ok');
    expect(limiter.active).toBe(0);
  });

  it('allows full parallelism when under the limit', async () => {
    const limiter = createConcurrencyLimiter(10);
    let running = 0;
    let peak = 0;
    const task = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await tick();
      running -= 1;
    };
    await Promise.all(Array.from({ length: 5 }, () => limiter.run(task)));
    expect(peak).toBe(5);
  });
});