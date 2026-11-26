import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError, errorResponse } from '@/lib/rbac';
import { parsePagination, withPaginationHeaders } from '@/lib/pagination';
import { requireAnalysisAdmin } from '@/lib/analysis/api-auth';

export const runtime = 'nodejs';

const STATUSES = ['pending', 'approved', 'dismissed', 'published'] as const;

export async function GET(req: NextRequest) {
  try {
    await requireAnalysisAdmin(req);
    const { page, pageSize, offset } = parsePagination(req);
    const params = req.nextUrl.searchParams;
    const where: Prisma.AnalysisResultWhereInput = {};

    const runId = params.get('runId');
    const league = params.get('league');
    const status = params.get('status');
    const date = params.get('date');
    const minConfidence = params.get('minConfidence');
    const maxConfidence = params.get('maxConfidence');

    if (runId) where.runId = runId;
    if (league) where.league = league;
    if (status) {
      if (!(STATUSES as readonly string[]).includes(status)) throw new ApiError(400, 'Invalid status');
      where.status = status as (typeof STATUSES)[number];
    }
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(400, 'Invalid date');
      const start = new Date(`${date}T00:00:00.000Z`);
      where.kickoff = { gte: start, lt: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
    }
    const confidenceFilter: Prisma.DecimalFilter = {};
    if (minConfidence) confidenceFilter.gte = Number(minConfidence);
    if (maxConfidence) confidenceFilter.lte = Number(maxConfidence);
    if (minConfidence || maxConfidence) where.confidence = confidenceFilter;

    // Only results belonging to completed runs are reviewable. Results from
    // failed, running, pending or deferred runs remain inspectable through the
    // run detail/audit view, but never enter the normal results list.
    where.run = { status: 'completed' };

    const [results, total] = await Promise.all([
      prisma.analysisResult.findMany({
        where,
        orderBy: [{ confidence: 'desc' }, { kickoff: 'asc' }],
        skip: offset,
        take: pageSize,
      }),
      prisma.analysisResult.count({ where }),
    ]);

    const response = NextResponse.json({
      results: results.map((result) => ({
        ...result,
        // Honest, additive alias: the stored `confidence` is a heuristic model
        // score, not a calibrated probability (audit §E). `modelScore` exposes
        // the same value under a non-probabilistic name; `confidence` is kept
        // for backwards compatibility with existing consumers and records.
        modelScore: Number(result.confidence),
        // Stage 6: enrichment quality + provenance so superadmins can see when a
        // pick was built on degraded/fallback data or with unavailable odds, and
        // exactly which markets were skipped and why.
        dataQuality: {
          enrichment: result.enrichmentQuality,
          provider: result.providerSource,
          missing: result.missingDataFields,
          oddsAvailable: result.bestOdds !== null,
          oddsSource: result.oddsSource,
          oddsCapturedAt: result.oddsCapturedAt,
          fixtureStatus: result.fixtureStatus,
          seasonId: result.seasonId,
          exclusionReason: result.marketExclusionReason,
        },
      })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
    return withPaginationHeaders(response, page, pageSize, total);
  } catch (err) {
    return errorResponse(err);
  }
}
