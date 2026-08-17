import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { prisma } from './prisma';

const ANOMALY_DEVICE_THRESHOLD = 3; // distinct devices within the window below is flagged, not blocked
const ANOMALY_WINDOW_HOURS = 24;
const MAX_CONCURRENT_SESSIONS = 5;
const INACTIVITY_DAYS = 30;
const INACTIVITY_MS = INACTIVITY_DAYS * 24 * 60 * 60 * 1000;

function fingerprint(req: NextRequest): { fingerprint: string; ip: string } {
  const ua = req.headers.get('user-agent') ?? 'unknown';
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  // Deliberately fingerprint on user-agent only, not IP — IP changes
  // constantly on mobile networks and would make this useless as a "same
  // device" signal. IP is still stored per-session for the admin view.
  const fp = crypto.createHash('sha256').update(ua).digest('hex').slice(0, 32);
  return { fingerprint: fp, ip };
}

/**
 * Called on every successful login. Design doc Section 11: "anti-account
 * sharing: concurrent session/device limits + anomaly detection" — this
 * implements the detection half (tracking + an admin-visible signal). It
 * deliberately does NOT block logins on its own; flagging false positives
 * (shared family plan, VPN, etc.) as hard blocks would be actively harmful
 * to legitimate users. An admin can act on the signal manually for now.
 */
export async function touchSession(userId: string, req: NextRequest) {
  const { fingerprint: fp, ip } = fingerprint(req);

  const existing = await prisma.userSession.findFirst({ where: { userId, deviceFingerprint: fp } });
  if (existing) {
    await prisma.userSession.update({ where: { id: existing.id }, data: { lastSeenAt: new Date(), ip } });
  } else {
    await prisma.userSession.create({ data: { userId, deviceFingerprint: fp, ip } });
  }

  await enforceMaxSessions(userId);
}

export async function getDistinctDeviceCount(userId: string): Promise<number> {
  const since = new Date(Date.now() - ANOMALY_WINDOW_HOURS * 60 * 60 * 1000);
  const sessions = await prisma.userSession.findMany({ where: { userId, lastSeenAt: { gte: since } } });
  return new Set(sessions.map((s: any) => s.deviceFingerprint)).size;
}

export async function isAnomalous(userId: string): Promise<boolean> {
  return (await getDistinctDeviceCount(userId)) >= ANOMALY_DEVICE_THRESHOLD;
}

export async function isSessionInactive(userId: string): Promise<boolean> {
  const sessions = await prisma.userSession.findMany({
    where: { userId },
    orderBy: { lastSeenAt: 'desc' },
    take: 1,
  });

  if (!sessions.length) return false;
  const lastSeen = sessions[0].lastSeenAt;
  return Date.now() - lastSeen.getTime() > INACTIVITY_MS;
}

export async function deleteInactiveSessions(userId: string): Promise<number> {
  const cutoff = new Date(Date.now() - INACTIVITY_MS);
  const result = await prisma.userSession.deleteMany({
    where: { userId, lastSeenAt: { lt: cutoff } },
  });
  return result.count;
}

export async function enforceMaxSessions(userId: string): Promise<void> {
  const sessions = await prisma.userSession.findMany({
    where: { userId },
    orderBy: { lastSeenAt: 'asc' },
  });

  if (sessions.length > MAX_CONCURRENT_SESSIONS) {
    const toRemove = sessions.slice(0, sessions.length - MAX_CONCURRENT_SESSIONS);
    await prisma.userSession.deleteMany({
      where: { id: { in: toRemove.map((s) => s.id) } },
    });
  }
}
