import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, errorResponse } from '@/lib/rbac';

const REDACTED_PAYLOAD_KEYS = new Set([
  'authorization_code',
  'card_token',
  'token',
  'secret',
  'password',
  'cvv',
  'pin',
  'otp',
  'raw',
]);

function redactPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) return payload.map(redactPayload);

  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (REDACTED_PAYLOAD_KEYS.has(key.toLowerCase())) {
      clone[key] = '[redacted]';
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      clone[key] = redactPayload(value);
    } else {
      clone[key] = value;
    }
  }
  return clone;
}

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const status = req.nextUrl.searchParams.get('status') as 'pending' | 'success' | 'failed' | null;
    const transactions = await prisma.transaction.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const safe = transactions.map((tx) => ({
      ...tx,
      rawPayload: redactPayload(tx.rawPayload),
    }));

    return NextResponse.json(safe);
  } catch (err) {
    return errorResponse(err);
  }
}
