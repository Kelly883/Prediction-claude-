import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminWith2FA, errorResponse } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { requireSameOrigin, requireCsrf } from '@/lib/csrf';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(req);
    requireCsrf(req);
    const admin = await requireAdminWith2FA(req);
    const { id } = await params;
    const post = await prisma.predictionPost.update({ where: { id }, data: { status: 'published' } });
    await writeAudit({ actorId: admin.sub, action: 'prediction.publish', targetId: post.id });
    return NextResponse.json(post);
  } catch (err) {
    return errorResponse(err);
  }
}
