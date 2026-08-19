import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePermission, errorResponse } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { writeAudit } from '@/lib/audit';
import { CmsSectionUpdateSchema } from '@/lib/schemas';
import { requireCsrf } from '@/lib/csrf';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ page: string }> }) {
  try {
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
