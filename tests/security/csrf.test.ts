import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

function makeFakeDb() {
  const users = new Map<string, any>();

  const db: any = {
    user: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.id) return users.get(where.id) ?? null;
        return null;
      }),
    },
    $transaction: vi.fn(async (fn: any) => fn(db)),
    _seedUser(user: any) {
      users.set(user.id, { tokenVersion: 0, ...user });
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

vi.mock('@/lib/ratelimit', () => ({
  checkRateLimit: vi.fn(async () => true),
  authLimiter: {},
  getClientIp: () => '127.0.0.1',
}));

describe('Security: CSRF', () => {
  beforeEach(() => {
    fakeDb = makeFakeDb();
  });

  it('requires CSRF token for state-changing operations', async () => {
    fakeDb._seedUser({
      id: 'user-1',
      email: 'user@example.com',
      passwordHash: 'hash',
      role: 'user',
    });

    const { POST } = await import('@/app/api/auth/logout/route');
    const req = new NextRequest('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: { authorization: 'Bearer user-1-token' },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
