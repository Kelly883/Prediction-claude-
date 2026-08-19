import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireAdminWith2FA, errorResponse } from '@/lib/rbac';
import { confirmCsvImport } from '@/lib/csv-import';
import { writeAudit } from '@/lib/audit';
import { CsvConfirmSchema } from '@/lib/schemas';
import { requireSameOrigin, requireCsrf } from '@/lib/csrf';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    requireSameOrigin(req);
    requireCsrf(req);
    const admin = await requireAdminWith2FA(req);
    const dto = CsvConfirmSchema.parse(await req.json());
    const post = await confirmCsvImport({
      ...dto,
      freeUntil: dto.freeUntil ? new Date(dto.freeUntil) : undefined,
      createdById: admin.sub,
    });
    await writeAudit({ actorId: admin.sub, action: 'prediction.csv_import', targetId: post.id });
    return NextResponse.json(post);
  } catch (err) {
    return errorResponse(err);
  }
}
