import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePermission, errorResponse } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { UpdatePlanSchema } from '@/lib/schemas';
import { PERMISSIONS } from '@/lib/permissions';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requirePermission(req, PERMISSIONS.pages.plans);
    const { id } = await params;
    const dto = UpdatePlanSchema.parse(await req.json());
    const plan = await prisma.plan.update({ where: { id }, data: dto });
    await writeAudit({ actorId: admin.sub, action: 'plan.update', targetId: plan.id, metadata: dto });
    return NextResponse.json(plan);
  } catch (err) {
    return errorResponse(err);
  }
}
