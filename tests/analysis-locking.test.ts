import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// In-memory Redis stub implementing the distributed-lock primitives:
// NX `set`, `get`, and an atomic compare-and-set `eval` (Lua GET==ARGV then
// EXPIRE/DEL). `incr`/`expire`/`del` are best-effort.
// ---------------------------------------------------------------------------
const store = new Map<string, unknown>();

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/redis', () => ({
  redis: {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      const k = String(key);
      if (opts?.nx && store.has(k)) return null;
      store.set(k, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => { store.delete(String(key)); return 1; }),
    incr: vi.fn(async (key: string) => {
      const k = String(key);
      const n = Number(store.get(k)) || 0;
      store.set(k, n + 1);
      return n + 1;
    }),
    expire: vi.fn(async () => 1),
    eval: vi.fn(async (_lua: string, keys: string[], args: unknown[]) => {
      const k = String(keys[0]);
      const current = store.get(k);
      if (current !== null && current === args[0]) {
        if (String(_lua).includes('DEL')) store.delete(k);
        return 1;
      }
      return 0;
    }),
  },
}));

import {
  createRunLockState,
  acquireAnalysisLock,
  renewAnalysisLock,
  releaseAnalysisLock,
  startLockRenewal,
  stopLockRenewal,
  type RunLockState,
} from '@/lib/analysis/run';

const DAY = new Date().toISOString().slice(0, 10);
const LOCK_KEY = `analysis:daily:${DAY}`;

beforeEach(() => {
  store.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('analysis lock (H2): owner token + NX acquisition', () => {
  it('acquires the lock with a unique owner token', async () => {
    const s = createRunLockState();
    const token = await acquireAnalysisLock(s, DAY, 600);
    expect(typeof token).toBe('string');
    expect(token!.length).toBeGreaterThan(0);
    expect(s.owner).toBe(token);
    expect(store.get(LOCK_KEY)).toBe(token);
  });

  it('rejects a second caller for the same day (NX semantics)', async () => {
    const s1 = createRunLockState();
    const s2 = createRunLockState();
    const t1 = await acquireAnalysisLock(s1, DAY, 600);
    const t2 = await acquireAnalysisLock(s2, DAY, 600);
    expect(t1).not.toBeNull();
    expect(t2).toBeNull();
    expect(s2.owner).toBeNull();
    expect(store.get(LOCK_KEY)).toBe(t1);
  });

  it('generates a distinct token per acquisition', async () => {
    const s1 = createRunLockState();
    const t1 = await acquireAnalysisLock(s1, DAY, 600);
    store.delete(LOCK_KEY);
    const s2 = createRunLockState();
    const t2 = await acquireAnalysisLock(s2, DAY, 600);
    expect(t1).not.toBe(t2);
  });
});

describe('analysis lock (H2): atomic ownership checks', () => {
  it('renewal succeeds only for the current owner (compare-and-set)', async () => {
    const holder = createRunLockState();
    const token = await acquireAnalysisLock(holder, DAY, 600); // store[LOCK_KEY] = token
    const owner = createRunLockState();
    owner.owner = token;
    const impostor = createRunLockState();
    impostor.owner = 'impostor';
    expect(await renewAnalysisLock(owner, DAY, 600)).toBe(true);
    expect(await renewAnalysisLock(impostor, DAY, 600)).toBe(false);
    expect(store.get(LOCK_KEY)).toBe(token);
  });

  it('release deletes the lock only for the current owner', async () => {
    const holder = createRunLockState();
    const token = await acquireAnalysisLock(holder, DAY, 600);
    const owner = createRunLockState();
    owner.owner = token;
    const impostor = createRunLockState();
    impostor.owner = 'impostor';
    await releaseAnalysisLock(impostor);
    expect(store.has(LOCK_KEY)).toBe(true); // not deleted by non-owner
    await releaseAnalysisLock(owner);
    expect(store.has(LOCK_KEY)).toBe(false); // deleted by owner
    expect(owner.owner).toBeNull();
  });

  it('release is a no-op when no lock is held', async () => {
    const s = createRunLockState();
    await expect(releaseAnalysisLock(s)).resolves.toBeUndefined();
    expect(s.owner).toBeNull();
  });
});

describe('analysis lock (H2): renewal timer lifecycle', () => {
  it('starts a renewal interval and clears it on stop', async () => {
    const s = createRunLockState();
    s.owner = 'token-x';
    store.set(LOCK_KEY, 'token-x');
    startLockRenewal(s, DAY, 600, 30_000);
    expect(s.timer).not.toBeNull();
    expect(s.lost).toBe(false);
    stopLockRenewal(s);
    expect(s.timer).toBeNull();
  });

  it('marks ownership lost and stops renewing when renewal fails', async () => {
    const s = createRunLockState();
    s.owner = 'token-x';
    store.set(LOCK_KEY, 'other-token'); // ownership revoked before renewal
    startLockRenewal(s, DAY, 600, 20);
    expect(s.timer).not.toBeNull();
    await new Promise((r) => setTimeout(r, 60)); // let the interval fire + async callback complete
    expect(s.lost).toBe(true);
    expect(s.timer).toBeNull();
  });
});
