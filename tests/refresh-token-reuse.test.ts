import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { issueRefreshToken } from '@/lib/auth';
import { consumeRefreshJti } from '@/lib/refresh-jti';

// Regression tests for cross-instance refresh-token rotation:
// previously, used JTI tracking was an in-process Set (lib/auth.ts), which
// does not survive serverless instance boundaries — a replayed refresh token
// would pass reuse detection on any other instance.

function makeFakeDb() {
  const users = new Map<string, any>();
  const sessions = new Map<string, any>();

  const db: any = {
    user: {
      findUnique: vi.fn(async ({ where }: any) => users.get(where.id) ?? null),
    },
    userSession: {
      findMany: vi.fn(async ({ where }: any) =>
        [...sessions.values()].filter((s: any) => s.userId === where.userId)
      ),
      updateMany: vi.fn(async ({ where, data }: any) => {
        for (const [id, s] of sessions.entries()) {
          if (s.userId === where.userId) {
            sessions.set(id, { ...s, ...data });
          }
        }
        return { count: 1 };
      }),
    },
    _seedUser(user: any) {
      users.set(user.id, { tokenVersion: 0, ...user });
    },
    _seedSession(session: any) {
      sessions.set(session.id, session);
    },
  };
  return db;
}

let fakeDb: ReturnType<typeof makeFakeDb>;

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return fakeDb;
  },
}));

// Explicit NX-aware mock of @/lib/redis — same rationale as
// tests/superadmin-setup.test.ts: ci.yml sets placeholder Upstash env vars,
// so without a mock, lib/redis.ts builds a real client that DNS-fails on
// example.upstash.io with retries and blows past vitest's 5s timeout. The
// mock honors SET NX so consumeRefreshJti's claim-on-consume semantics are
// genuinely exercised rather than accidentally passing via fail-open.
const mockRedisStore = vi.hoisted(() => new Map<string, string>());
vi.mock('@/lib/redis', () => ({
  redis: {
    get: vi.fn(async (key: string) => mockRedisStore.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, opts?: { nx?: boolean }) => {
      if (opts?.nx && mockRedisStore.has(key)) {
        return null;
      }
      mockRedisStore.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => (mockRedisStore.delete(key) ? 1 : 0)),
  },
}));

describe('consumeRefreshJti claim-on-consume semantics', () => {
  beforeEach(() => {
    mockRedisStore.clear();
  });

  it('claims a fresh jti and rejects the same jti on second consume', async () => {
    const first = await consumeRefreshJti('jti-test-1');
    expect(first).toBe(true);

    const replay = await consumeRefreshJti('jti-test-1');
    expect(replay).toBe(false);
  });

  it('treats distinct jtis independently', async () => {
    expect(await consumeRefreshJti('jti-a')).toBe(true);
    expect(await consumeRefreshJti('jti-b')).toBe(true);
  });
});

describe('POST /api/auth/refresh rejects a replayed rotated token', () => {
  beforeEach(() => {
    fakeDb = makeFakeDb();
    process.env.SESSION_IDLE_TIMEOUT_MS = '86400000';
    fakeDb._seedUser({
      id: 'user-rot-1',
      email: 'rotate@example.com',
      passwordHash: 'hash',
      tokenVersion: 0,
      role: 'user',
      deletedAt: null,
    });
    fakeDb._seedSession({
      id: 'sess-rot-1',
      userId: 'user-rot-1',
      deviceFingerprint: 'fp-rot',
      lastSeenAt: new Date(Date.now() - 30 * 60 * 1000),
      ip: '127.0.0.1',
    });
  });

  async function postRefresh(token: string) {
    const { POST: refreshTokenRoute } = await import('@/app/api/auth/refresh/route');
    const req = new NextRequest('http://localhost/api/auth/refresh', {
      method: 'POST',
      headers: { cookie: `refresh_token=${token}` },
    });
    return refreshTokenRoute(req);
  }

  it('succeeds on first use, then revokes the session when the old token is replayed', async () => {
    const originalToken = await issueRefreshToken('user-rot-1', 0);

    // First use: valid — rotates to a new refresh token.
    const res1 = await postRefresh(originalToken);
    expect(res1.status).toBe(200);

    const rotatedToken = res1.cookies.get('refresh_token')?.value;
    expect(rotatedToken).toBeTruthy();

    // Replay of the ORIGINAL (already-consumed) token must be rejected.
    const res2 = await postRefresh(originalToken);
    expect(res2.status).toBe(401);
    expect(await res2.json()).toEqual({ error: 'Session revoked. Please log in again.' });

    // The newly issued rotated token still works exactly once.
    fakeDb._seedSession({
      id: 'sess-rot-1b',
      userId: 'user-rot-1',
      deviceFingerprint: 'fp-rot',
      lastSeenAt: new Date(),
      ip: '127.0.0.1',
    });
    const res3 = await postRefresh(rotatedToken!);
    expect(res3.status).toBe(200);
  });
});
