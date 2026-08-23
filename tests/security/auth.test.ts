import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { issueAccessToken } from '@/lib/auth';

function makeFakeDb() {
  const users = new Map<string, any>();
  const sessions = new Map<string, any>();
  const emailVerificationTokens = new Map<string, any>();
  const twoFactorRecoveryCodes = new Map<string, any>();

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
      update: vi.fn(async ({ where, data }: any) => {
        const u = users.get(where.id);
        if (!u) throw new Error('User not found');
        const updated = { ...u, ...data };
        users.set(where.id, updated);
        return updated;
      }),
    },
    userSession: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    emailVerificationToken: {
      updateMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async (data: any) => {
        const id = `evt-${Date.now()}`;
        const record = { id, ...data.data };
        emailVerificationTokens.set(id, record);
        return record;
      }),
      findFirst: vi.fn(async () => null),
    },
    twoFactorRecoveryCode: {
      findFirst: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
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

vi.mock('@/lib/csrf', () => ({
  requireSameOrigin: vi.fn(),
  requireCsrf: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }));

vi.mock('@/lib/twofactor', () => ({
  verifyTotpCode: vi.fn().mockReturnValue(true),
}));

vi.mock('@/lib/emails', () => ({
  sendVerificationEmail: vi.fn(),
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

  it('rejects verified user email change without permission', async () => {
    const token = await issueAccessToken({ sub: 'user-1', role: 'user' });

    fakeDb._seedUser({
      id: 'user-1',
      email: 'user@test.com',
      role: 'user',
      emailVerifiedAt: new Date(),
      permissions: [],
      twoFactorSecret: null,
    });

    const { PATCH } = await import('@/app/api/me/route');
    const req = new NextRequest('http://localhost/api/me', {
      method: 'PATCH',
      headers: {
        cookie: `access_token=${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'new@test.com' }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(403);
  });

  it('allows verified admin with changeEmail permission to change email', async () => {
    const token = await issueAccessToken({ sub: 'admin-1', role: 'admin' });

    fakeDb._seedUser({
      id: 'admin-1',
      email: 'admin@test.com',
      role: 'admin',
      emailVerifiedAt: new Date(),
      permissions: ['admin.changeEmail'],
      twoFactorSecret: null,
    });

    const { PATCH } = await import('@/app/api/me/route');
    const req = new NextRequest('http://localhost/api/me', {
      method: 'PATCH',
      headers: {
        cookie: `access_token=${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'newadmin@test.com' }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.email).toBe('newadmin@test.com');
  });

  it('requires 2FA for superadmin email change', async () => {
    const token = await issueAccessToken({ sub: 'super-1', role: 'superadmin' });

    fakeDb._seedUser({
      id: 'super-1',
      email: 'super@test.com',
      role: 'superadmin',
      emailVerifiedAt: new Date(),
      permissions: [],
      twoFactorSecret: 'encrypted-secret',
    });

    const { PATCH } = await import('@/app/api/me/route');
    const req = new NextRequest('http://localhost/api/me', {
      method: 'PATCH',
      headers: {
        cookie: `access_token=${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'newsuper@test.com' }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/two-factor/i);
  });

  it('allows superadmin email change with valid 2FA code', async () => {
    const token = await issueAccessToken({ sub: 'super-1', role: 'superadmin' });

    fakeDb._seedUser({
      id: 'super-1',
      email: 'super@test.com',
      role: 'superadmin',
      emailVerifiedAt: new Date(),
      permissions: [],
      twoFactorSecret: 'encrypted-secret',
    });

    const { PATCH } = await import('@/app/api/me/route');
    const req = new NextRequest('http://localhost/api/me', {
      method: 'PATCH',
      headers: {
        cookie: `access_token=${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'newsuper@test.com', twoFactorCode: '123456' }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.email).toBe('newsuper@test.com');
  });
});
