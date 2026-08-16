import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, publicLimiter, getClientIp } from '@/lib/ratelimit';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const allowed = await checkRateLimit(publicLimiter, ip);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const dbLatencyStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const dbLatencyMs = Date.now() - dbLatencyStart;

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      checks: {
        database: { status: 'ok', latencyMs: dbLatencyMs },
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: 'error',
        timestamp: new Date().toISOString(),
        checks: {
          database: { status: 'error' },
        },
      },
      { status: 500 }
    );
  }
}
