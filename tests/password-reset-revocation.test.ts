import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { issueRefreshToken } from '@/lib/auth';

function makeFakeDb() {
  const users = new Map<string, any>();
  const sessions = new Map<string, any>();
  const resetTokens = new Map<string, any>();
  const auditLogs: any[] = [];

  const db: any = {
    user: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.id) return users.get(where.id) ?? null;
        if (where.email) return [...users.values()].find((u) => u.email === where.email) ?? null;
        return null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const u = users.get(where.id);
        const updated = {
          ...u,
          ...data,
          tokenVersion: data.tokenVersion?.increment ? (u.tokenVersion ?? 0) + 1 : (data.tokenVersion ?? u.tokenVersion),
        };
        users.set(where.id, updated);
        return updated;
      }),
    },
    userSession: {
      deleteMany: vi.fn(async ({ where }: any) => {
        let count = 0;
        for (const [id, s] of sessions.entries()) {
          if (s.userId === where.userId) {
            sessions.delete(id);
            count++;
          }
        }
        return { count };
      }),
    },
    refreshSession: {
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    passwordResetToken: {
      findUnique: vi.fn(async ({ where }: any) => {
        return resetTokens.get(where.tokenHash) ?? null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const t = resetTokens.get(where.id);
        const updated = { ...t, ...data };
        resetTokens.set(where.id, updated);
        return updated;
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: any) => {
        auditLogs.push(data);
        return { id: 'audit-1', ...data };
      }),
    },
    $transaction: vi.fn(async (fn: any) => fn(db)),
    _seedUser(user: any) {
      users.set(user.id, { tokenVersion: 0, ...user });
    },
    _seedSession(session: any) {
      sessions.set(session.id, session);
    },
    _seedResetToken(token: any) {
      resetTokens.set(token.tokenHash, token);
      resetTokens.set(token.id, token);
    },
    _getUser: (id: string) => users.get(id),
    _getSessionCount: () => sessions.size,
    _getAuditLogs: () => auditLogs,
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

describe('Password Reset Session Revocation & Token Versioning', () => {
  beforeEach(() => {
    fakeDb = makeFakeDb();
    fakeDb._seedUser({
      id: 'user-reset-1',
      email: 'user@example.com',
      passwordHash: 'old_hash_123',
      tokenVersion: 1,
      role: 'user',
    });

    fakeDb._seedSession({ id: 'sess-1', userId: 'user-reset-1', deviceFingerprint: 'fp-1' });
    fakeDb._seedSession({ id: 'sess-2', userId: 'user-reset-1', deviceFingerprint: 'fp-2' });
  });

  it('revokes all active sessions and increments tokenVersion on password reset', async () => {
    const rawToken = 'test-raw-reset-token-123';
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    fakeDb._seedResetToken({
      id: 'tok-1',
      userId: 'user-reset-1',
      tokenHash,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      usedAt: null,
    });

    // Old refresh token issued before reset
    const oldRefreshToken = await issueRefreshToken('user-reset-1', 1);

    expect(fakeDb._getSessionCount()).toBe(2);

    const { POST: confirmPasswordReset } = await import('@/app/api/auth/password-reset/confirm/route');
    const req = new NextRequest('http://localhost/api/auth/password-reset/confirm', {
      method: 'POST',
      body: JSON.stringify({
        token: rawToken,
        newPassword: 'BrandNewSecurePassword123!',
      }),
    });

    const res = await confirmPasswordReset(req);
    expect(res.status).toBe(200);

    // 1. Sessions are purged
    expect(fakeDb._getSessionCount()).toBe(0);

    // 2. Token version was incremented
    const updatedUser = fakeDb._getUser('user-reset-1');
    expect(updatedUser.tokenVersion).toBe(2);

    // 3. Old refresh token is rejected at refresh endpoint
    const { POST: refreshTokenRoute } = await import('@/app/api/auth/refresh/route');
    const refreshReq = new NextRequest('http://localhost/api/auth/refresh', {
      method: 'POST',
      headers: {
        cookie: `refresh_token=${oldRefreshToken}`,
      },
    });

    const refreshRes = await refreshTokenRoute(refreshReq);
    expect(refreshRes.status).toBe(401);
  });
});
