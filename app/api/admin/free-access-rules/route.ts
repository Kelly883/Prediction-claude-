import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, errorResponse } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { FreeAccessRuleSchema } from '@/lib/schemas';

export const runtime = 'nodejs';

// PRD Section 5: "Admin can configure: Global free trial days for new
// signups (0-N days), Optional: promo free windows (start/end datetime)".
// lib/entitlement.ts already reads these; this is the API to create them.
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const rules = await prisma.freeAccessRule.findMany({ orderBy: { createdAt: 'desc' } });
    return NextResponse.json(rules);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
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
