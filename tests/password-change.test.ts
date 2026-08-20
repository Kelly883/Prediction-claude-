import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockPrisma = vi.hoisted(() => {
  const users = new Map<string, any>();
  const sessions = new Map<string, any>();
  const auditLogs: any[] = [];

  return {
    users,
    sessions,
    auditLogs,
    user: {
      findUnique: vi.fn(async ({ where }: any) => users.get(where.id) ?? null),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => {
        const u = users.get(where.id);
        if (!u) throw new Error('User not found');
        return u;
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
    auditLog: {
      create: vi.fn(async ({ data }: any) => {
        auditLogs.push(data);
        return { id: 'audit-1', ...data };
      }),
    },
    $transaction: vi.fn(async (fn: any) => fn(mockPrisma)),
    seedUser(user: any) {
      users.set(user.id, { tokenVersion: 0, ...user });
    },
    seedSession(session: any) {
      sessions.set(session.id, session);
    },
    getUser: (id: string) => users.get(id),
    getSessionCount: () => sessions.size,
    getAuditLogs: () => auditLogs,
  };
});

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<any>('@/lib/auth');
  return {
    ...actual,
    verifyAccessToken: vi.fn(async () => ({ sub: 'user-pw-1', role: 'user' })),
  };
});
vi.mock('@/lib/password', async () => {
  const actual = await vi.importActual<any>('@/lib/password');
  return {
    ...actual,
    verifyPassword: vi.fn(async (password: string) => password === 'OldPassword123!'),
  };
});

import { PATCH as changePassword } from '@/app/api/me/password/route';

describe('Password Change API', () => {
  beforeEach(() => {
    mockPrisma.users.clear();
    mockPrisma.sessions.clear();
    mockPrisma.auditLogs.length = 0;
    vi.clearAllMocks();

    mockPrisma.seedUser({
      id: 'user-pw-1',
      email: 'user@example.com',
      passwordHash: '$2b$12$' + 'a'.repeat(53),
      tokenVersion: 0,
      role: 'user',
    });

    mockPrisma.seedSession({ id: 'sess-1', userId: 'user-pw-1', deviceFingerprint: 'fp-1' });
    mockPrisma.seedSession({ id: 'sess-2', userId: 'user-pw-1', deviceFingerprint: 'fp-2' });
  });

  it('changes password, revokes all sessions, and increments tokenVersion', async () => {
    const req = new NextRequest('http://localhost/api/me/password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: 'access_token=fake-access-token-for-user-pw-1' },
      body: JSON.stringify({
        currentPassword: 'OldPassword123!',
        newPassword: 'NewSecurePassword456!',
      }),
    });

    const res = await changePassword(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.message).toContain('logged out of all devices');

    const updatedUser = mockPrisma.getUser('user-pw-1');
    expect(updatedUser.tokenVersion).toBe(1);
    expect(updatedUser.passwordHash).not.toBe('$2b$12$' + 'a'.repeat(53));

    expect(mockPrisma.getSessionCount()).toBe(0);

    const auditLogs = mockPrisma.getAuditLogs();
    expect(auditLogs.some((log: any) => log.action === 'auth.password_changed')).toBe(true);
  });

  it('rejects change with incorrect current password', async () => {
    const req = new NextRequest('http://localhost/api/me/password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: 'access_token=fake-access-token-for-user-pw-1' },
      body: JSON.stringify({
        currentPassword: 'WrongPassword!',
        newPassword: 'NewSecurePassword456!',
      }),
    });

    const res = await changePassword(req);
    expect(res.status).toBe(401);

    const updatedUser = mockPrisma.getUser('user-pw-1');
    expect(updatedUser.tokenVersion).toBe(0);
    expect(mockPrisma.getSessionCount()).toBe(2);

    const auditLogs = mockPrisma.getAuditLogs();
    expect(auditLogs.some((log: any) => log.action === 'auth.password_change_failed')).toBe(true);
  });
});
