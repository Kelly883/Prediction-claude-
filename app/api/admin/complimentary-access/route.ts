import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, errorResponse } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { ComplimentaryAccessSchema } from '@/lib/schemas';
import { requireCsrf } from '@/lib/csrf';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const grants = await prisma.complimentaryAccess.findMany({
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { email: true } }, post: { select: { title: true } } },
    });
    return NextResponse.json(grants);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    requireCsrf(req);
    const admin = await requireAdmin(req);
    const dto = ComplimentaryAccessSchema.parse(await req.json());

    const grant = await prisma.complimentaryAccess.create({
      data: {
        userId: dto.userId,
        postId: dto.postId ?? null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });

    await writeAudit({ actorId: admin.sub, action: 'complimentary_access.grant', targetId: grant.id, metadata: dto });
    return NextResponse.json(grant);
  } catch (err) {
    return errorResponse(err);
  }
}
