import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

function makeFakeDb() {
  const users = new Map<string, any>();

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

describe('Security: authorization', () => {
  beforeEach(() => {
    fakeDb = makeFakeDb();
  });

  it('prevents user from accessing admin endpoints', async () => {
    fakeDb._seedUser({
      id: 'user-1',
      email: 'user@example.com',
      passwordHash: 'hash',
      role: 'user',
    });

    const { PATCH } = await import('@/app/api/admin/users/[id]/route');
    const req = new NextRequest('http://localhost:3000/api/admin/users/user-1', {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer fake-admin-token',
        cookie: 'access_token=fake-user-token',
      },
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'user-1' }) });
    expect(res.status).toBe(401);
  });

  it('prevents accessing another user resource with own token', async () => {
    fakeDb._seedUser({
      id: 'user-1',
      email: 'user1@example.com',
      passwordHash: 'hash',
      role: 'user',
    });
    fakeDb._seedUser({
      id: 'user-2',
      email: 'user2@example.com',
      passwordHash: 'hash',
      role: 'user',
    });

    const { GET } = await import('@/app/api/me/route');
    const req = new NextRequest('http://localhost/api/me', {
      headers: { authorization: 'Bearer user-2-token' },
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
