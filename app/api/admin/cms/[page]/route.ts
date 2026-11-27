import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePermission, errorResponse, ApiError } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { writeAudit } from '@/lib/audit';
import { CmsSectionUpdateSchema } from '@/lib/schemas';
import { requireCsrf, requireSameOrigin } from '@/lib/csrf';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ page: string }> }) {
  try {
    requireSameOrigin(req);
    requireCsrf(req);
    const admin = await requirePermission(req, PERMISSIONS.pages.cms);
    const { page } = await params;
    const { key, content } = CmsSectionUpdateSchema.parse(await req.json());

    const section = await prisma.cmsSection.upsert({
      where: { page_key: { page, key } },
      update: { content, updatedById: admin.sub },
      create: { page, key, content, updatedById: admin.sub },
    });

    await writeAudit({ actorId: admin.sub, action: 'cms.update', targetId: section.id, metadata: { page, key } });
    return NextResponse.json(section);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ page: string }> }) {
  try {
    requireSameOrigin(req);
    requireCsrf(req);
    const admin = await requirePermission(req, PERMISSIONS.pages.cms);
    const { page } = await params;
    const key = req.nextUrl.searchParams.get('key');
    if (!key) throw new ApiError(400, 'A section key query parameter is required');

    const removed = await prisma.cmsSection.deleteMany({ where: { page, key } });
    await writeAudit({ actorId: admin.sub, action: 'cms.delete', targetId: key, metadata: { page, key } });
    return NextResponse.json({ ok: true, deleted: removed.count });
  } catch (err) {
    return errorResponse(err);
  }
}