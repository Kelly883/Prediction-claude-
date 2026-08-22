import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { issueRefreshToken } from '@/lib/auth';
import { hashRefreshToken } from '@/lib/refresh-sessions';

function makeFakeDb() {
  const users = new Map<string, any>();
  const sessions = new Map<string, any>();
  const refreshSessions = new Map<string, any>();

  const db: any = {
    user: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.id) return users.get(where.id) ?? null;
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
      findMany: vi.fn(async ({ where }: any) => {
        return [...sessions.values()].filter((s: any) => s.userId === where.userId);
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        for (const [id, s] of sessions.entries()) {
          if (s.userId === where.userId) {
            sessions.set(id, { ...s, ...data });
          }
        }
        return { count: [...sessions.values()].filter((s: any) => s.userId === where.userId).length };
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    refreshSession: {
      findFirst: vi.fn(async ({ where }: any) => {
        if (where.userId && where.tokenHash) {
          return [...refreshSessions.values()].find((s: any) => s.userId === where.userId && s.tokenHash === where.tokenHash) ?? null;
        }
        if (where.userId && where.familyId) {
          return [...refreshSessions.values()].find((s: any) => s.userId === where.userId && s.familyId === where.familyId) ?? null;
        }
        return null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const s = refreshSessions.get(where.id);
        if (s) {
          const updated = { ...s, ...data };
          refreshSessions.set(where.id, updated);
          return updated;
        }
        return { id: where.id, ...data };
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }: any) => {
        const id = `rs-${Date.now()}`;
        const record = { id, ...data, createdAt: new Date(), updatedAt: new Date() };
        refreshSessions.set(id, record);
        return record;
      }),
    },
    $transaction: vi.fn(async (fn: any) => fn(db)),
    _seedUser(user: any) {
      users.set(user.id, { tokenVersion: 0, ...user });
    },
    _seedSession(session: any) {
      sessions.set(session.id, session);
    },
    _seedRefreshSession(session: any) {
      refreshSessions.set(session.id, session);
    },
    _getUser: (id: string) => users.get(id),
    _getSession: (id: string) => sessions.get(id),
    _getRefreshSession: (id: string) => refreshSessions.get(id),
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

describe('Refresh idle timeout', () => {
  beforeEach(() => {
    fakeDb = makeFakeDb();
    process.env.SESSION_IDLE_TIMEOUT_MS = '86400000';
  });

  it('allows refresh when session is active', async () => {
    fakeDb._seedUser({
      id: 'user-1',
      email: 'user@example.com',
      passwordHash: 'hash',
      tokenVersion: 0,
      role: 'user',
      deletedAt: null,
    });
    fakeDb._seedSession({
      id: 'sess-1',
      userId: 'user-1',
      deviceFingerprint: 'fp-1',
      lastSeenAt: new Date(Date.now() - 30 * 60 * 1000),
      ip: '127.0.0.1',
    });

    const refreshToken = await issueRefreshToken('user-1', 0);
    const tokenHash = hashRefreshToken(refreshToken);
    fakeDb._seedRefreshSession({
      id: 'rs-1',
      userId: 'user-1',
      tokenHash,
      familyId: 'family-1',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revokedAt: undefined,
    });

    const { POST: refreshTokenRoute } = await import('@/app/api/auth/refresh/route');
    const req = new NextRequest('http://localhost/api/auth/refresh', {
      method: 'POST',
      headers: { cookie: `refresh_token=${refreshToken}` },
    });

    const res = await refreshTokenRoute(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const updated = fakeDb._getSession('sess-1');
    expect(updated.lastSeenAt.getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  it('rejects refresh when session is idle beyond timeout', async () => {
    fakeDb._seedUser({
      id: 'user-2',
      email: 'user2@example.com',
      passwordHash: 'hash',
      tokenVersion: 0,
      role: 'user',
      deletedAt: null,
    });
    fakeDb._seedSession({
      id: 'sess-2',
      userId: 'user-2',
      deviceFingerprint: 'fp-2',
      lastSeenAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      ip: '127.0.0.1',
    });

    const refreshToken = await issueRefreshToken('user-2', 0);
    const { POST: refreshTokenRoute } = await import('@/app/api/auth/refresh/route');
    const req = new NextRequest('http://localhost/api/auth/refresh', {
      method: 'POST',
      headers: { cookie: `refresh_token=${refreshToken}` },
    });

    const res = await refreshTokenRoute(req);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Session expired due to inactivity. Please log in again.' });
    expect((res.cookies.get('access_token')?.expires as Date | undefined)?.getTime()).toBeLessThan(Date.now());
    expect((res.cookies.get('refresh_token')?.expires as Date | undefined)?.getTime()).toBeLessThan(Date.now());
  });

  it('allows refresh when user has no sessions', async () => {
    fakeDb._seedUser({
      id: 'user-3',
      email: 'user3@example.com',
      passwordHash: 'hash',
      tokenVersion: 0,
      role: 'user',
      deletedAt: null,
    });

    const refreshToken = await issueRefreshToken('user-3', 0);
    const tokenHash = hashRefreshToken(refreshToken);
    fakeDb._seedRefreshSession({
      id: 'rs-3',
      userId: 'user-3',
      tokenHash,
      familyId: 'family-3',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revokedAt: undefined,
    });

    const { POST: refreshTokenRoute } = await import('@/app/api/auth/refresh/route');
    const req = new NextRequest('http://localhost/api/auth/refresh', {
      method: 'POST',
      headers: { cookie: `refresh_token=${refreshToken}` },
    });

    const res = await refreshTokenRoute(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('allows refresh when only some sessions are idle', async () => {
    fakeDb._seedUser({
      id: 'user-4',
      email: 'user4@example.com',
      passwordHash: 'hash',
      tokenVersion: 0,
      role: 'user',
      deletedAt: null,
    });
    fakeDb._seedSession({
      id: 'sess-4a',
      userId: 'user-4',
      deviceFingerprint: 'fp-4a',
      lastSeenAt: new Date(Date.now() - 30 * 60 * 1000),
      ip: '127.0.0.1',
    });
    fakeDb._seedSession({
      id: 'sess-4b',
      userId: 'user-4',
      deviceFingerprint: 'fp-4b',
      lastSeenAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      ip: '127.0.0.1',
    });

    const refreshToken = await issueRefreshToken('user-4', 0);
    const tokenHash = hashRefreshToken(refreshToken);
    fakeDb._seedRefreshSession({
      id: 'rs-4',
      userId: 'user-4',
      tokenHash,
      familyId: 'family-4',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revokedAt: undefined,
    });

    const { POST: refreshTokenRoute } = await import('@/app/api/auth/refresh/route');
    const req = new NextRequest('http://localhost/api/auth/refresh', {
      method: 'POST',
      headers: { cookie: `refresh_token=${refreshToken}` },
    });

    const res = await refreshTokenRoute(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const updatedA = fakeDb._getSession('sess-4a');
    const updatedB = fakeDb._getSession('sess-4b');
    expect(updatedA.lastSeenAt.getTime()).toBeGreaterThan(Date.now() - 5000);
    expect(updatedB.lastSeenAt.getTime()).toBeGreaterThan(Date.now() - 5000);
  });
});
