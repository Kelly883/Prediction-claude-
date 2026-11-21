import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError, errorResponse } from '@/lib/rbac';
import { parsePagination, withPaginationHeaders } from '@/lib/pagination';
import { requireAnalysisAdmin } from '@/lib/analysis/api-auth';

export const runtime = 'nodejs';

const STATUSES = ['pending', 'running', 'completed', 'failed'] as const;

export async function GET(req: NextRequest) {
  try {
    await requireAnalysisAdmin(req);
    const { page, pageSize, offset } = parsePagination(req);
    const status = req.nextUrl.searchParams.get('status');
    const date = req.nextUrl.searchParams.get('date');
    const where: Prisma.AnalysisRunWhereInput = {};

    if (status) {
      if (!(STATUSES as readonly string[]).includes(status)) throw new ApiError(400, 'Invalid status');
      where.status = status as (typeof STATUSES)[number];
    }
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(400, 'Invalid date');
      where.runDate = new Date(`${date}T00:00:00.000Z`);
    }

    const [runs, total] = await Promise.all([
      prisma.analysisRun.findMany({
        where,
        orderBy: [{ runDate: 'desc' }, { createdAt: 'desc' }],
        skip: offset,
        take: pageSize,
        include: { _count: { select: { results: true } } },
      }),
      prisma.analysisRun.count({ where }),
    ]);

    const response = NextResponse.json({ runs, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
    return withPaginationHeaders(response, page, pageSize, total);
  } catch (err) {
    return errorResponse(err);
  }
}
