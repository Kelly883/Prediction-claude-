import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, errorResponse, ApiError } from '@/lib/rbac';

export const runtime = 'nodejs';

/**
 * Lets the post-checkout callback page ask "did this actually succeed?"
 * Scoped to the logged-in user's own transactions — a reference alone
 * shouldn't let anyone look up someone else's payment.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const reference = req.nextUrl.searchParams.get('reference');
    if (!reference) throw new ApiError(400, 'reference is required');

    const tx = await prisma.transaction.findUnique({ where: { providerReference: reference } });
    if (!tx || tx.userId !== user.sub) throw new ApiError(404, 'Not found');

    return NextResponse.json({ status: tx.status, amount: tx.amount, currency: tx.currency }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
