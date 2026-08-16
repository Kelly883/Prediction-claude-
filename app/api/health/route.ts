import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
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
        error: 'Database connectivity check failed',
      },
      { status: 500 }
    );
  }
}
