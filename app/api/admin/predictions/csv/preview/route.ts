import { NextRequest, NextResponse } from 'next/server';
import { requirePermission, errorResponse } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { requireSameOrigin, requireCsrf } from '@/lib/csrf';
import { previewCsv } from '@/lib/csv-import';
import { checkRateLimit, csvUploadLimiter } from '@/lib/ratelimit';

export const runtime = 'nodejs';
const MAX_CSV_BYTES = 2 * 1024 * 1024; // 2MB — generous for a matchday CSV, caps resource use from an oversized/malformed upload

export async function POST(req: NextRequest) {
  try {
    requireSameOrigin(req);
    requireCsrf(req);
    const admin = await requirePermission(req, PERMISSIONS.pages.predictions);
    if (!(await checkRateLimit(csvUploadLimiter, admin.sub))) {
      return NextResponse.json({ error: 'Too many uploads, try again shortly' }, { status: 429 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 });
    if (file.size > MAX_CSV_BYTES) {
      return NextResponse.json({ error: `File too large — max ${MAX_CSV_BYTES / 1024 / 1024}MB` }, { status: 400 });
    }

    const csvContent = await file.text();
    return NextResponse.json(previewCsv(csvContent));
  } catch (err) {
    return errorResponse(err);
  }
}
