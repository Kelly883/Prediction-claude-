import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

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
    },
    userSession: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 0 })),
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

describe('Security: authentication', () => {
  beforeEach(() => {
    fakeDb = makeFakeDb();
  });

  it('rejects access with missing token', async () => {
    const { GET } = await import('@/app/api/me/route');
    const req = new NextRequest('http://localhost/api/me');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('rejects access with garbage token', async () => {
    const { GET } = await import('@/app/api/me/route');
    const req = new NextRequest('http://localhost/api/me', {
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('does not allow refresh token as access token', async () => {
    const { issueRefreshToken, verifyAccessToken } = await import('@/lib/auth');
    const refreshToken = await issueRefreshToken('user-1', 0);
    const payload = await verifyAccessToken(refreshToken);
    expect(payload).toBeNull();
  });
});
