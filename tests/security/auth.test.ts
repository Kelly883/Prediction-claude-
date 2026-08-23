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
      findUniqueOrThrow: vi.fn(async ({ where }: any) => {
        if (where.id) {
          const found = users.get(where.id);
          if (!found) throw new Error('User not found');
          return found;
        }
        if (where.email) {
          const found = [...users.values()].find((u) => u.email === where.email);
          if (!found) throw new Error('User not found');
          return found;
        }
        throw new Error('User not found');
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

  it('returns all permissions for superadmin users via /api/me', async () => {
    const { issueAccessToken } = await import('@/lib/auth');
    const token = await issueAccessToken({ sub: 'superadmin-1', role: 'superadmin' });

    fakeDb._seedUser({ id: 'superadmin-1', email: 'super@test.com', role: 'superadmin', deletedAt: null });

    const { GET } = await import('@/app/api/me/route');
    const req = new NextRequest('http://localhost/api/me', {
      headers: { cookie: `access_token=${token}` },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.role).toBe('superadmin');
    expect(Array.isArray(json.permissions)).toBe(true);
    expect(json.permissions.length).toBeGreaterThan(0);
    expect(json.permissions).toContain('pages.overview');
    expect(json.permissions).toContain('admin.createAdmins');
  });
});
