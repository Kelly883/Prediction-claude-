import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePermission, errorResponse } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { writeAudit } from '@/lib/audit';
import { requireSameOrigin, requireCsrf } from '@/lib/csrf';

export const runtime = 'nodejs';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(req);
    requireCsrf(req);
    const admin = await requirePermission(req, PERMISSIONS.pages.freeAccess);
    const { id } = await params;
    await prisma.complimentaryAccess.delete({ where: { id } });
    await writeAudit({ actorId: admin.sub, action: 'complimentary_access.revoke', targetId: id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
