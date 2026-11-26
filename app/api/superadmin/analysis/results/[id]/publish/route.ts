import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ApiError, errorResponse } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { requireAnalysisAdmin } from '@/lib/analysis/api-auth';
import { marketRequiresOdds } from '@/lib/analysis/markets/eligibility';

export const runtime = 'nodejs';

interface Context {
  params: Promise<{ id: string }>;
}

const PublishSchema = z.object({
  bookingCode: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(200).optional(),
  visibility: z.enum(['plan_specific', 'subscribers', 'free_window']).default('subscribers'),
  planIds: z.array(z.string()).default([]),
  bodyNotes: z.string().trim().max(2000).optional(),
  scheduledAt: z.string().datetime().optional(),
});

export async function POST(req: NextRequest, context: Context) {
  try {
    const admin = await requireAnalysisAdmin(req, true);
    const { id } = await context.params;
    const dto = PublishSchema.parse(await req.json());

    // Fast pre-checks before opening the transaction. The authoritative
    // eligibility checks are repeated inside the transaction below.
    const result = await prisma.analysisResult.findUnique({ where: { id } });
    if (!result) throw new ApiError(404, 'Analysis result not found');
    if (result.predictionPostId || result.status === 'published') throw new ApiError(409, 'Pick already published');
    if (result.status !== 'approved') throw new ApiError(409, 'Only approved picks can be published');

    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : result.kickoff;

    const post = await prisma.$transaction(async (tx) => {
      // Re-fetch inside the transaction so the completed-run requirement and
      // the not-yet-published guard are re-checked against the latest
      // committed state, not a potentially stale pre-transaction read.
      const current = await tx.analysisResult.findUnique({ where: { id }, include: { run: true } });
      if (!current) throw new ApiError(409, 'Analysis result not found');
      if (current.run.status !== 'completed') {
        throw new ApiError(409, `Cannot publish a result whose parent run is ${current.run.status}`);
      }
      if (current.status !== 'approved') throw new ApiError(409, 'Only approved picks can be published');
      if (current.predictionPostId) throw new ApiError(409, 'Pick already published');
      // A market that requires a real bookmaker price cannot be published
      // without one — never surface a model estimate as a price.
      if (marketRequiresOdds(current.bestMarket) && current.bestOdds === null) {
        throw new ApiError(409, `Cannot publish ${current.bestMarket}: no captured bookmaker price available`);
      }

      const created = await tx.predictionPost.create({
        data: {
          title: dto.title ?? `${current.homeTeam} vs ${current.awayTeam}`,
          scheduledAt,
          bookingCode: dto.bookingCode,
          bodyNotes: dto.bodyNotes,
          visibility: dto.visibility,
          planIds: dto.planIds,
          status: 'published',
          createdById: admin.sub,
          items: {
            create: {
              match: `${current.homeTeam} vs ${current.awayTeam}`,
              prediction: `${current.bestMarket}: ${current.bestSelection}`,
              matchDateTime: current.kickoff,
            },
          },
        },
      });

      // Conditional state transition: only one concurrent request can flip the
      // result from unpublished to published. `status: 'approved'` plus
      // `predictionPostId: null` in the where clause makes the update match
      // nothing when another request has dismissed or already published this
      // result. Throwing inside the transaction rolls back the newly created
      // prediction post too.
      const updated = await tx.analysisResult.updateMany({
        where: { id, status: 'approved', predictionPostId: null },
        data: {
          status: 'published',
          predictionPostId: created.id,
          reviewedById: admin.sub,
          reviewedAt: new Date(),
        },
      });
      if (updated.count === 0) {
        throw new ApiError(409, 'Pick was already published or dismissed by another request');
      }

      return created;
    });

    await writeAudit({
      actorId: admin.sub,
      action: 'analysis.pick.publish',
      targetType: 'prediction_post',
      targetId: post.id,
      metadata: {
        analysisResultId: id,
        visibility: dto.visibility,
        bestMarket: result.bestMarket,
      },
    });

    return NextResponse.json(post, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
