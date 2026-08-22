import { NextRequest, NextResponse } from 'next/server';
import { requirePermission, errorResponse } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { requireSameOrigin, requireCsrf } from '@/lib/csrf';
import { previewCsv } from '@/lib/csv-import';
import { checkRateLimit, csvUploadLimiter } from '@/lib/ratelimit';

export const runtime = 'nodejs';
const MAX_CSV_BYTES = 2 * 1024 * 1024; // 2MB — generous for a matchday CSV, caps resource use from an oversized/malformed upload

// Browsers label the same .csv file inconsistently depending on OS/registry,
// so several text-ish types are allowed. An empty `file.type` is also allowed
// but is then covered by the binary-sniff below.
const ALLOWED_CSV_MIME_TYPES = new Set([
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
  'text/plain',
]);

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

    // Server-side content-type validation (never trust the client-declared
    // extension) plus a binary sniff: real CSV is plain text, so a NUL byte
    // in the first KB means this is not parseable text regardless of what
    // the declared MIME type claims.
    if (file.type && !ALLOWED_CSV_MIME_TYPES.has(file.type.toLowerCase())) {
      return NextResponse.json({ error: 'Invalid file type — upload a .csv file' }, { status: 400 });
    }
    const head = Buffer.from(await file.slice(0, 1024).arrayBuffer());
    if (head.includes(0)) {
      return NextResponse.json({ error: 'File contains binary data — upload a plain-text CSV' }, { status: 400 });
    }

    const csvContent = await file.text();
    return NextResponse.json(previewCsv(csvContent));
  } catch (err) {
    return errorResponse(err);
  }
}
