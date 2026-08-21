import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/password';
import { hashRefreshToken, createRefreshSession, revokeAllRefreshSessions, revokeExpiredSessions, revokeFamily } from '@/lib/refresh-sessions';

function buildRequest(headers: Record<string, string> = {}): any {
  return {
    headers: new Map(Object.entries(headers)),
    cookies: {
      get: (_name: string) => undefined,
    },
    json: async () => ({}),
  } as any;
}

describe('P0-01 Persistent Refresh Token Rotation', () => {
  beforeEach(async () => {
    await prisma.refreshSession.deleteMany();
    await prisma.userSession.deleteMany();
    await prisma.user.deleteMany();
  });

  it('creates and validates a refresh session persistently', async () => {
    const user = await prisma.user.create({
      data: {
        name: 'Test User',
        email: 'test@example.com',
        passwordHash: await hashPassword('password123'),
        country: 'NG',
        role: 'user',
      },
    });

    const token = crypto.randomUUID();
    const tokenHash = hashRefreshToken(token);
    const familyId = crypto.randomUUID();

    await createRefreshSession({
      userId: user.id,
      tokenHash,
      tokenVersion: user.tokenVersion,
      familyId,
      ip: '127.0.0.1',
    });

    const session = await prisma.refreshSession.findFirst({
      where: { userId: user.id, tokenHash },
    });

    expect(session).toBeTruthy();
    expect(session!.familyId).toBe(familyId);
    expect(session!.revokedAt).toBeUndefined();
  });

  it('rejects reuse of a revoked refresh token', async () => {
    const user = await prisma.user.create({
      data: {
        name: 'Test User',
        email: 'test2@example.com',
        passwordHash: await hashPassword('password123'),
        country: 'NG',
        role: 'user',
      },
    });

    const token1 = crypto.randomUUID();
    const token2 = crypto.randomUUID();
    const tokenHash1 = hashRefreshToken(token1);
    const tokenHash2 = hashRefreshToken(token2);
    const familyId = crypto.randomUUID();

    const session1 = await createRefreshSession({
      userId: user.id,
      tokenHash: tokenHash1,
      tokenVersion: user.tokenVersion,
      familyId,
      ip: '127.0.0.1',
    });

    await prisma.refreshSession.update({
      where: { id: session1.id },
      data: { revokedAt: new Date() },
    });

    const session2 = await prisma.refreshSession.findFirst({
      where: { userId: user.id, tokenHash: tokenHash2, revokedAt: null },
    });

    expect(session2).toBeNull();
  });

  it('revokes all sessions for a user', async () => {
    const user = await prisma.user.create({
      data: {
        name: 'Test User',
        email: 'test3@example.com',
        passwordHash: await hashPassword('password123'),
        country: 'NG',
        role: 'user',
      },
    });

    await createRefreshSession({
      userId: user.id,
      tokenHash: hashRefreshToken(crypto.randomUUID()),
      tokenVersion: user.tokenVersion,
      familyId: crypto.randomUUID(),
    });

    await createRefreshSession({
      userId: user.id,
      tokenHash: hashRefreshToken(crypto.randomUUID()),
      tokenVersion: user.tokenVersion,
      familyId: crypto.randomUUID(),
    });

    const count = await revokeAllRefreshSessions(user.id);

    const remaining = await prisma.refreshSession.findMany({
      where: { userId: user.id, revokedAt: null },
    });

    expect(count).toBeGreaterThanOrEqual(2);
    expect(remaining).toHaveLength(0);
  });

  it('revokes an entire family on replay detection', async () => {
    const user = await prisma.user.create({
      data: {
        name: 'Test User',
        email: 'test4@example.com',
        passwordHash: await hashPassword('password123'),
        country: 'NG',
        role: 'user',
      },
    });

    const familyId = crypto.randomUUID();

    await createRefreshSession({
      userId: user.id,
      tokenHash: hashRefreshToken(crypto.randomUUID()),
      tokenVersion: user.tokenVersion,
      familyId,
    });

    await createRefreshSession({
      userId: user.id,
      tokenHash: hashRefreshToken(crypto.randomUUID()),
      tokenVersion: user.tokenVersion,
      familyId,
    });

    const revokedCount = await revokeFamily(familyId);

    const remaining = await prisma.refreshSession.findMany({
      where: { familyId, revokedAt: null },
    });

    expect(revokedCount).toBe(2);
    expect(remaining).toHaveLength(0);
  });

  it('revokes expired sessions safely', async () => {
    const user = await prisma.user.create({
      data: {
        name: 'Test User',
        email: 'test5@example.com',
        passwordHash: await hashPassword('password123'),
        country: 'NG',
        role: 'user',
      },
    });

    const session = await createRefreshSession({
      userId: user.id,
      tokenHash: hashRefreshToken(crypto.randomUUID()),
      tokenVersion: user.tokenVersion,
      familyId: crypto.randomUUID(),
      ttlSeconds: -1,
    });

    const deleted = await revokeExpiredSessions();

    const remaining = await prisma.refreshSession.findUnique({
      where: { id: session.id },
    });

    expect(deleted).toBe(1);
    expect(remaining).toBeNull();
  });
});
