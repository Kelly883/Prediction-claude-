import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  userSession: { findFirst: vi.fn(), findMany: vi.fn().mockReturnValue([]), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
  emailVerificationToken: {
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    create: vi.fn().mockResolvedValue({ id: 'evt-1', userId: 'user-1', tokenHash: 'hash', expiresAt: new Date() }),
  },
  $transaction: vi.fn(async (fn: any) => fn(mockPrisma)),
}));

const mockPassword = vi.hoisted(() => ({
  verifyPassword: vi.fn(),
  hashPassword: vi.fn().mockResolvedValue('$2b$12$newhash'),
}));

const mockAuth = vi.hoisted(() => ({
  issueAccessToken: vi.fn().mockResolvedValue('access-token'),
  issueRefreshToken: vi.fn().mockResolvedValue('refresh-token'),
  cookieOptions: vi.fn(() => ({})),
}));

const mockAudit = vi.hoisted(() => ({
  writeAudit: vi.fn(),
}));

const mockEmails = vi.hoisted(() => ({
  sendVerificationEmail: vi.fn(),
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
vi.mock('@/lib/audit', () => mockAudit);
vi.mock('@/lib/emails', () => mockEmails);
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

describe('login email normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPassword.verifyPassword.mockResolvedValue(true);
    mockPrisma.user.update.mockResolvedValue({});
  });

  it('finds the user regardless of casing in the request', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(makeUser({ emailVerifiedAt: new Date() }));

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'Test@Example.COM', password: 'password123' }),
    });
    const res = await POST(req as any);

    expect(res.status).toBe(200);
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'test@example.com' } });
  });

  it('rejects login for unverified email and sends verification email', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(makeUser({ emailVerifiedAt: null }));

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com', password: 'password123' }),
    });
    const res = await POST(req as any);

    expect(res.status).toBe(403);
    expect(mockEmails.sendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(mockPrisma.emailVerificationToken.create).toHaveBeenCalledTimes(1);
  });

  it('allows login for verified email', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(makeUser({ emailVerifiedAt: new Date() }));

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com', password: 'password123' }),
    });
    const res = await POST(req as any);

    expect(res.status).toBe(200);
  });
});
