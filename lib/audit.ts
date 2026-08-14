import { prisma } from './prisma';

/**
 * Replaces the NestJS AuditInterceptor (which relied on a decorator + DI
 * to run automatically). There's no equivalent "wrap every route" hook in
 * plain Route Handlers, so each admin mutation route calls this explicitly
 * as its last step. See README "Things that changed" for why this is the
 * one place manual discipline is required instead of being enforced by the
 * framework — a lint rule or codemod checking every app/api/admin/** route
 * calls writeAudit() is a reasonable follow-up.
 */
export async function writeAudit(params: {
  actorId: string;
  action: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: params.actorId,
        action: params.action,
        targetType: params.action.split('.')[0],
        targetId: params.targetId ?? null,
        metadata: redact(params.metadata) as any,
      },
    });
  } catch (err) {
    // Audit logging must never break the request it's logging.
    console.error(`Failed to write audit log for action=${params.action}`, err);
  }
}

function redact(obj: Record<string, unknown> | undefined) {
  if (!obj) return obj;
  const clone = { ...obj };
  delete clone.password;
  delete clone.passwordHash;
  return clone;
}
