import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, errorResponse } from '@/lib/rbac';
import { confirmCsvImport } from '@/lib/csv-import';
import { writeAudit } from '@/lib/audit';
import { CsvConfirmSchema } from '@/lib/schemas';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const dto = CsvConfirmSchema.parse(await req.json());
    // dto.rows must be the previously-previewed, zero-error row set the
    // admin confirmed in the UI — this route does not re-validate row
    // contents, only their shape, matching the two-step preview/confirm
    // flow in the PRD.
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
