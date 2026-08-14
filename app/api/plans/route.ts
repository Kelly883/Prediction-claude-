import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/rbac';
import { checkRateLimit, defaultLimiter } from '@/lib/ratelimit';

export const runtime = 'nodejs';

// Public — visible to logged-out users per PRD Section 6 (Paywall behavior).
// Rate limited even though it's unauthenticated: no auth wall + a DB read
// per request is exactly the shape of endpoint that gets scraped/hammered.
export async function GET(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
    if (!(await checkRateLimit(defaultLimiter, ip))) {
      return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 });
    }
    const plans = await prisma.plan.findMany({ where: { isActive: true } });
    return NextResponse.json(plans);
  } catch (err) {
    return errorResponse(err);
  }
}
