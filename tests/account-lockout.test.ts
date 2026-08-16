import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

const mockPassword = vi.hoisted(() => ({
  verifyPassword: vi.fn(),
  hashPassword: vi.fn().mockResolvedValue('$2b$12$newhash'),
}));

const mockAuth = vi.hoisted(() => ({
  issueAccessToken: vi.fn().mockResolvedValue('access-token'),
  issueRefreshToken: vi.fn().mockResolvedValue('refresh-token'),
  issueTwoFactorChallengeToken: vi.fn(),
  cookieOptions: vi.fn(() => ({})),
}));

const mockSessions = vi.hoisted(() => ({
  touchSession: vi.fn(),
  isAnomalous: vi.fn().mockResolvedValue(false),
}));

const mockAudit = vi.hoisted(() => ({
  writeAudit: vi.fn(),
}));

const mockRatelimit = vi.hoisted(() => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
  authLimiter: {},
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  normalizeIdentifier: vi.fn((_type: string, value: string) => value.toLowerCase()),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/password', () => mockPassword);
vi.mock('@/lib/auth', () => mockAuth);
vi.mock('@/lib/sessions', () => mockSessions);
vi.mock('@/lib/audit', () => mockAudit);
vi.mock('@/lib/ratelimit', () => mockRatelimit);

import { POST } from '@/app/api/auth/login/route';

function makeUser(overrides: any = {}) {
  return {
    id: 'user-1',
    email: 'test@example.com',
    passwordHash: '$2b$12$' + 'a'.repeat(53),
    twoFactorEnabled: false,
    twoFactorSecret: null,
    tokenVersion: 0,
    role: 'user',
    failedLoginAttempts: 0,
    lockedUntil: null,
    ...overrides,
  };
}

describe('account lockout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPassword.verifyPassword.mockResolvedValue(false);
    mockPrisma.user.update.mockImplementation(({ data }: any) => {
      const updated = { ...mockPrisma.user.findUnique.mock.results[0]?.value, ...data };
      mockPrisma.user.findUnique.mockResolvedValue(updated);
      return Promise.resolve(updated);
    });
  });

  it('locks account after 5 failed attempts', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(makeUser());

    for (let i = 0; i < 5; i++) {
      const req = new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com', password: 'wrong' }),
      });
      const res = await POST(req as any);
      expect(res.status).toBe(401);
    }

    const lastCall = mockPrisma.user.update.mock.calls[mockPrisma.user.update.mock.calls.length - 1][0];
    expect(lastCall.data.failedLoginAttempts).toBe(5);
    expect(lastCall.data.lockedUntil).toBeInstanceOf(Date);
  });

  it('returns 403 for locked account even with correct password', async () => {
    const lockedUser = makeUser({
      failedLoginAttempts: 5,
      lockedUntil: new Date(Date.now() + 30 * 60 * 1000),
    });
    mockPrisma.user.findUnique.mockResolvedValue(lockedUser);
    mockPassword.verifyPassword.mockResolvedValue(true);

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com', password: 'correct' }),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(403);
  });

  it('resets failed attempts on successful login', async () => {
    const user = makeUser({ failedLoginAttempts: 3 });
    mockPrisma.user.findUnique.mockResolvedValue(user);
    mockPassword.verifyPassword.mockResolvedValue(true);

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com', password: 'correct' }),
    });

    const res = await POST(req as any);
    expect(res.status).toBe(200);

    expect(mockPrisma.user.update).toHaveBeenLastCalledWith({
      where: { id: 'user-1' },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  });
});
