import { NextRequest, NextResponse } from 'next/server';
import { requireUser, errorResponse } from '@/lib/rbac';
import { cancelAutoRenew } from '@/lib/payments';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const sub = await cancelAutoRenew(user.sub);
    return NextResponse.json(sub);
  } catch (err) {
    return errorResponse(err);
  }
}
