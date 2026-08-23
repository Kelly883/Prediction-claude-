import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { count: vi.fn().mockResolvedValue(0) } },
}));

// Explicit mock, not reliance on lib/redis.ts's real-vs-in-memory fallback
// behavior: that fallback depends on whether UPSTASH_REDIS_REST_URL/TOKEN
// happen to be set in whatever environment runs this test. Locally they
// weren't set, so the real module silently used its in-memory fallback and
// these tests passed — accidentally, not because the test was actually
// isolated. In CI, the workflow sets both to placeholder values
// (ci.yml: UPSTASH_REDIS_REST_URL=https://example.upstash.io) so the real
// module believed Redis was genuinely configured and attempted a real
// network call to a host that doesn't resolve, failing with ENOTFOUND. A
// unit test for lib/superadmin-setup.ts's logic should never depend on
// which env vars happen to be present in whichever environment runs it.
const mockRedisStore = vi.hoisted(() => new Map<string, string>());
vi.mock('@/lib/redis', () => ({
  redis: {
    get: vi.fn(async (key: string) => mockRedisStore.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      mockRedisStore.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      const existed = mockRedisStore.delete(key);
      return existed ? 1 : 0;
    }),
  },
}));

describe('lib/superadmin-setup pending session storage', () => {
  beforeEach(() => {
    mockRedisStore.clear();
  });

  it('a value set can be read back by a separate call, not just within the same process lifetime', async () => {
    const { setPending, getPending } = await import('@/lib/superadmin-setup');
    await setPending('session-1', { name: 'Ada', email: 'ada@example.com', passwordHash: 'hash', encryptedSecret: 'v1:enc' });

    const result = await getPending('session-1');
    expect(result).toEqual({ name: 'Ada', email: 'ada@example.com', passwordHash: 'hash', encryptedSecret: 'v1:enc' });
  });

  it('consumePending deletes the entry so it cannot be reused', async () => {
    const { setPending, consumePending, getPending } = await import('@/lib/superadmin-setup');
    await setPending('session-2', { name: 'Bo', email: 'bo@example.com', passwordHash: 'hash', encryptedSecret: 'v1:enc' });

    const first = await consumePending('session-2');
    expect(first?.email).toBe('bo@example.com');

    const second = await consumePending('session-2');
    expect(second).toBeUndefined();
    expect(await getPending('session-2')).toBeUndefined();
  });

  it('returns undefined for an id that was never set', async () => {
    const { getPending } = await import('@/lib/superadmin-setup');
    expect(await getPending('never-existed')).toBeUndefined();
  });

  it('hasSuperAdmin reflects the actual database count', async () => {
    const { prisma } = await import('@/lib/prisma');
    (prisma.user.count as any).mockResolvedValueOnce(1);

    const { hasSuperAdmin } = await import('@/lib/superadmin-setup');
    expect(await hasSuperAdmin()).toBe(true);
  });
});
