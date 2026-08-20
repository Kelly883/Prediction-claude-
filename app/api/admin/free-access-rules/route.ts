import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePermission, errorResponse } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { writeAudit } from '@/lib/audit';
import { FreeAccessRuleSchema } from '@/lib/schemas';
import { requireCsrf } from '@/lib/csrf';

export const runtime = 'nodejs';

// PRD Section 5: "Admin can configure: Global free trial days for new
// signups (0-N days), Optional: promo free windows (start/end datetime)".
// lib/entitlement.ts already reads these; this is the API to create them.
export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, PERMISSIONS.pages.freeAccess);
    const rules = await prisma.freeAccessRule.findMany({ orderBy: { createdAt: 'desc' } });
    return NextResponse.json(rules);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    requireCsrf(req);
    const admin = await requirePermission(req, PERMISSIONS.pages.freeAccess);
    const dto = FreeAccessRuleSchema.parse(await req.json());

    const rule = await prisma.freeAccessRule.create({
      data: {
        type: dto.type,
        trialDays: dto.trialDays,
        startAt: dto.startAt ? new Date(dto.startAt) : undefined,
        endAt: dto.endAt ? new Date(dto.endAt) : undefined,
        isActive: dto.isActive ?? true,
      },
    });

    await writeAudit({ actorId: admin.sub, action: 'free_access_rule.create', targetId: rule.id, metadata: dto });
    return NextResponse.json(rule);
  } catch (err) {
    return errorResponse(err);
  }
}
