import { prisma } from './prisma';

export interface AuditLogParams {
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

const REDACTED_KEYS = new Set([
  'password',
  'passwordhash',
  'twofactorsecret',
  'secret',
  'renewalauthcode',
  'token',
  'challengetoken',
  'code',
  'authorizationcode',
  'rawtoken',
  'plainsecret',
  'apikey',
  'refreshtoken',
  'accesstoken',
]);

function redact(obj: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!obj) return obj;
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (REDACTED_KEYS.has(key.toLowerCase())) {
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      clone[key] = redact(value as Record<string, unknown>);
    } else {
      clone[key] = value;
    }
  }
  return clone;
}

/**
 * Persists an audit log or security event.
 * Audit logging must never fail the calling request.
 */
export async function writeAudit(params: AuditLogParams) {
  try {
    if (!prisma?.auditLog?.create) {
      return;
    }
    const targetType = params.targetType ?? params.action.split('.')[0];
    await prisma.auditLog.create({
      data: {
        actorId: params.actorId ?? null,
        action: params.action,
        targetType,
        targetId: params.targetId ?? null,
        metadata: redact(params.metadata) as any,
      },
    });
  } catch (err) {
    // Non-fatal: log error to stderr without interrupting business transaction
    console.error(`Failed to write audit log for action=${params.action}`, err);
  }
}
