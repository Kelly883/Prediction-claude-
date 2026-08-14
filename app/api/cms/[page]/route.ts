import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/rbac';
import { checkRateLimit, defaultLimiter } from '@/lib/ratelimit';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ page: string }> }) {
  try {
    const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
    if (!(await checkRateLimit(defaultLimiter, ip))) {
      return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 });
    }
    const { page } = await params;
    const sections = await prisma.cmsSection.findMany({ where: { page } });
    return NextResponse.json(sections);
  } catch (err) {
    return errorResponse(err);
  }
}
