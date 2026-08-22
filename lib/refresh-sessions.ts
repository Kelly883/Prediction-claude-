import crypto from 'crypto';
import { prisma } from './prisma';
import { writeAudit } from './audit';
import { timingSafeStringEqual } from './timing-safe';

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createRefreshSession(params: {
  userId: string;
  tokenHash: string;
  tokenVersion: number;
  familyId?: string;
  ip?: string | null;
  userAgent?: string | null;
  ttlSeconds?: number;
}): Promise<any> {
  const expiresAt = new Date(Date.now() + (params.ttlSeconds ?? 7 * 24 * 60 * 60) * 1000);
  return prisma.refreshSession.create({
    data: {
      userId: params.userId,
      tokenHash: params.tokenHash,
      familyId: params.familyId ?? crypto.randomUUID(),
      expiresAt,
      ip: params.ip ?? null,
      userAgent: params.userAgent ?? null,
    },
  });
}

export async function validateRefreshSession(
  userId: string,
  tokenHash: string,
  tokenVersion: number,
): Promise<any | null> {
  const session = await prisma.refreshSession.findFirst({
    where: {
      userId,
      tokenHash,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (!session) return null;

  if (session.replacedById) {
    return null;
  }

  return session;
}

export async function revokeRefreshSession(sessionId: string): Promise<void> {
  await prisma.refreshSession.update({
    where: { id: sessionId },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllRefreshSessions(userId: string): Promise<number> {
  const result = await prisma.refreshSession.updateMany({
    where: {
      userId,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function revokeFamily(familyId: string): Promise<number> {
  const result = await prisma.refreshSession.updateMany({
    where: {
      familyId,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function revokeExpiredSessions(): Promise<number> {
  const result = await prisma.refreshSession.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { revokedAt: { not: null } },
      ],
    },
  });
  return result.count;
}

export async function getActiveRefreshSession(userId: string, familyId: string): Promise<any | null> {
  return prisma.refreshSession.findFirst({
    where: {
      userId,
      familyId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
}

export async function handleRefreshTokenReuse(
  userId: string,
  familyId: string,
  ip: string,
): Promise<void> {
  const revokedCount = await revokeFamily(familyId);

  await writeAudit({
    actorId: userId,
    action: 'auth.refresh_token_reuse',
    metadata: {
      familyId,
      revokedCount,
      reason: 'refresh_token_replay_detected',
      ip,
    },
  });
}
