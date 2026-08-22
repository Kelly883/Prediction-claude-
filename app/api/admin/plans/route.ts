import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePermission, errorResponse } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { writeAudit } from '@/lib/audit';
import { CreatePlanSchema } from '@/lib/schemas';
import { requireCsrf } from '@/lib/csrf';
import { checkRateLimit, adminLimiter, getClientIp } from '@/lib/ratelimit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    requireCsrf(req);
    const admin = await requirePermission(req, PERMISSIONS.pages.plans);
    const ip = getClientIp(req);
    const allowed = await checkRateLimit(adminLimiter, [ip, `admin:${admin.sub}`]);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 });
    }

    const dto = CreatePlanSchema.parse(await req.json());
    const plan = await prisma.plan.create({ data: { isActive: true, ...dto } });
    await writeAudit({ actorId: admin.sub, action: 'plan.create', targetId: plan.id, metadata: dto });
    return NextResponse.json(plan);
  } catch (err) {
    return errorResponse(err);
  }
}
