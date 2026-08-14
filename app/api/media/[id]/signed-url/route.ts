import { NextRequest, NextResponse } from 'next/server';
import { requireUser, errorResponse } from '@/lib/rbac';
import { getSignedUrlForViewer } from '@/lib/media';
import { checkRateLimit, defaultLimiter } from '@/lib/ratelimit';

export const runtime = 'nodejs'; // sharp requires the Node runtime, not Edge

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    if (!(await checkRateLimit(defaultLimiter, user.sub))) {
      return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 });
    }
    const { id } = await params;
    const url = await getSignedUrlForViewer(user.sub, id);
    return NextResponse.json({ url, expiresInSeconds: Number(process.env.SIGNED_URL_TTL_SECONDS ?? 300) });
  } catch (err) {
    return errorResponse(err);
  }
}
