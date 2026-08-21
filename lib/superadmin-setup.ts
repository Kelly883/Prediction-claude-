import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';

export interface PendingBootstrap {
  name: string;
  email: string;
  passwordHash: string;
  encryptedSecret: string;
}

const TTL_SECONDS = 15 * 60;
const KEY_PREFIX = 'superadmin-bootstrap:';

// Was previously a plain in-process Map — module-level in-memory state does
// not reliably survive between requests on Vercel's serverless platform.
// The two-step bootstrap flow (POST /setup generates a pending id + TOTP
// secret, then POST /setup/verify consumes it moments later from the same
// browser) has no guarantee both requests land on the same Lambda
// instance; a cold start or a different concurrent instance between the
// two steps meant "Bootstrap session expired or not found" even for a
// code entered well within the TTL. Moved to the same Redis instance
// already used elsewhere in this codebase for rate limiting/FX caching —
// a real shared store, not per-instance memory. Falls back to the
// in-memory mock automatically (via lib/redis.ts) when Upstash isn't
// configured, same as everywhere else that imports `redis`.
export async function setPending(id: string, data: PendingBootstrap): Promise<void> {
  await redis.set(KEY_PREFIX + id, JSON.stringify(data), { ex: TTL_SECONDS });
}

export async function getPending(id: string): Promise<PendingBootstrap | undefined> {
  const raw = await redis.get<string>(KEY_PREFIX + id);
  if (!raw) return undefined;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : (raw as unknown as PendingBootstrap);
  } catch {
    return undefined;
  }
}

export async function consumePending(id: string): Promise<PendingBootstrap | undefined> {
  const entry = await getPending(id);
  if (entry) await redis.del(KEY_PREFIX + id);
  return entry;
}

export async function hasSuperAdmin(): Promise<boolean> {
  const count = await prisma.user.count({ where: { role: 'superadmin' } });
  return count > 0;
}
