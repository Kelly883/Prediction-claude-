import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';

function makeFakeDb() {
  const users = new Map<string, any>();
  const sessions = new Map<string, any>();

  const db: any = {
    user: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.id) return users.get(where.id) ?? null;
        if (where.email) return [...users.values()].find((u) => u.email === where.email) ?? null;
        return null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const u = users.get(where.id);
        const updated = { ...u, ...data };
        users.set(where.id, updated);
        return updated;
      }),
    },
    userSession: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 0 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    $transaction: vi.fn(async (fn: any) => fn(db)),
    _seedUser(user: any) {
      users.set(user.id, { tokenVersion: 0, ...user });
    },
    _getUser: (id: string) => users.get(id),
  };
  return db;
}

let fakeDb: ReturnType<typeof makeFakeDb>;

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return fakeDb;
  },
}));

vi.mock('@/lib/ratelimit', () => ({
  checkRateLimit: vi.fn(async () => true),
  authLimiter: {},
  getClientIp: () => '127.0.0.1',
}));

describe('Security: sessions', () => {
  beforeEach(() => {
    fakeDb = makeFakeDb();
  });

  it('rejects refresh when tokenVersion mismatches', async () => {
    fakeDb._seedUser({
      id: 'user-1',
      email: 'user@example.com',
      passwordHash: 'hash',
      tokenVersion: 2,
      role: 'user',
    });

    const { issueRefreshToken } = await import('@/lib/auth');
    const oldRefreshToken = await issueRefreshToken('user-1', 1);

    const { POST: refreshTokenRoute } = await import('@/app/api/auth/refresh/route');
    const req = new NextRequest('http://localhost/api/auth/refresh', {
      method: 'POST',
      headers: { cookie: `refresh_token=${oldRefreshToken}` },
    });

    const res = await refreshTokenRoute(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toContain('revoked');
  });

  it('rejects refresh when user is deleted', async () => {
    fakeDb._seedUser({
      id: 'user-2',
      email: 'deleted@example.com',
      passwordHash: 'hash',
      tokenVersion: 0,
      role: 'user',
      deletedAt: new Date(),
    });

    const { issueRefreshToken } = await import('@/lib/auth');
    const refreshToken = await issueRefreshToken('user-2', 0);

    const { POST: refreshTokenRoute } = await import('@/app/api/auth/refresh/route');
    const req = new NextRequest('http://localhost/api/auth/refresh', {
      method: 'POST',
      headers: { cookie: `refresh_token=${refreshToken}` },
    });

    const res = await refreshTokenRoute(req);
    expect(res.status).toBe(401);
  });

  it('rejects refresh when session is idle beyond timeout', async () => {
    fakeDb._seedUser({
      id: 'user-3',
      email: 'user3@example.com',
      passwordHash: 'hash',
      tokenVersion: 0,
      role: 'user',
    });
    fakeDb.userSession.findMany.mockResolvedValue([
      {
        id: 'sess-1',
        userId: 'user-3',
        deviceFingerprint: 'fp-1',
        lastSeenAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        ip: '127.0.0.1',
      },
    ]);

    const { issueRefreshToken } = await import('@/lib/auth');
    const refreshToken = await issueRefreshToken('user-3', 0);

    const { POST: refreshTokenRoute } = await import('@/app/api/auth/refresh/route');
    const req = new NextRequest('http://localhost/api/auth/refresh', {
      method: 'POST',
      headers: { cookie: `refresh_token=${refreshToken}` },
    });

    const res = await refreshTokenRoute(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toContain('inactivity');
  });
});
