import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePermission, errorResponse } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { generateReconciliationReport } from '@/lib/reconciliation';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, PERMISSIONS.pages.transactions);

    const now = new Date();
    const defaultStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const startDate = req.nextUrl.searchParams.get('startDate')
      ? new Date(req.nextUrl.searchParams.get('startDate')!)
      : defaultStart;
    const endDate = req.nextUrl.searchParams.get('endDate')
      ? new Date(req.nextUrl.searchParams.get('endDate')!)
      : now;

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return NextResponse.json({ error: 'Invalid date format. Use ISO 8601.' }, { status: 400 });
    }

    if (startDate > endDate) {
      return NextResponse.json({ error: 'startDate must be before endDate' }, { status: 400 });
    }

    const report = await generateReconciliationReport(startDate, endDate);
    return NextResponse.json(report);
  } catch (err) {
    return errorResponse(err);
  }
}
