import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, requireAdminWith2FA, errorResponse } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { requireSameOrigin, requireCsrf } from '@/lib/csrf';

export const runtime = 'nodejs';

// Only isActive is toggleable after creation — the rule's shape (type,
// trialDays, window dates) is deliberately immutable once created. A promo
// window that's already been active for two days shouldn't have its dates
// silently rewritten; end it (isActive: false) and create a new one instead,
// so the audit log keeps an honest record of what actually ran when.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(req);
    requireCsrf(req);
    const admin = await requireAdminWith2FA(req);
    const { id } = await params;
    const { isActive } = await req.json();

    const rule = await prisma.freeAccessRule.update({ where: { id }, data: { isActive: !!isActive } });
    await writeAudit({ actorId: admin.sub, action: 'free_access_rule.update', targetId: rule.id, metadata: { isActive } });
    return NextResponse.json(rule);
  } catch (err) {
    return errorResponse(err);
  }
}
