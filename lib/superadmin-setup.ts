import { prisma } from '@/lib/prisma';

export interface PendingBootstrap {
  name: string;
  email: string;
  passwordHash: string;
  encryptedSecret: string;
}

const TTL_MS = 15 * 60 * 1000;
const store = new Map<string, { data: PendingBootstrap; expiresAt: number }>();

export function setPending(id: string, data: PendingBootstrap) {
  store.set(id, { data, expiresAt: Date.now() + TTL_MS });
}

export function getPending(id: string): PendingBootstrap | undefined {
  const entry = store.get(id);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(id);
    return undefined;
  }
  return entry.data;
}

export function consumePending(id: string): PendingBootstrap | undefined {
  const entry = getPending(id);
  if (entry) store.delete(id);
  return entry;
}

export async function hasSuperAdmin(): Promise<boolean> {
  const count = await prisma.user.count({ where: { role: 'superadmin' } });
  return count > 0;
}
