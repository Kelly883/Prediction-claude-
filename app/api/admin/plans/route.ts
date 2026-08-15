import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, errorResponse } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { CreatePlanSchema } from '@/lib/schemas';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const dto = CreatePlanSchema.parse(await req.json());
    const plan = await prisma.plan.create({ data: { isActive: true, ...dto } });
    await writeAudit({ actorId: admin.sub, action: 'plan.create', targetId: plan.id, metadata: dto });
    return NextResponse.json(plan);
  } catch (err) {
    return errorResponse(err);
  }
}
