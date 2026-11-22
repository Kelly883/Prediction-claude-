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

    const result = await prisma.analysisResult.findUnique({ where: { id } });
    if (!result) throw new ApiError(404, 'Analysis result not found');
    if (result.predictionPostId || result.status === 'published') throw new ApiError(409, 'Pick already published');
    if (result.status !== 'approved') throw new ApiError(409, 'Only approved picks can be published');
    // A market that requires a real bookmaker price cannot be published without
    // one — never surface a model estimate as a bookmaker price (Stage 3).
    if (marketRequiresOdds(result.bestMarket) && result.bestOdds === null) {
      throw new ApiError(409, `Cannot publish ${result.bestMarket}: no captured bookmaker price available`);
    }

    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : result.kickoff;
    const post = await prisma.$transaction(async (tx) => {
      const created = await tx.predictionPost.create({
        data: {
          title: dto.title ?? `${result.homeTeam} vs ${result.awayTeam}`,
          scheduledAt,
          bookingCode: dto.bookingCode,
          bodyNotes: dto.bodyNotes,
          visibility: dto.visibility,
          planIds: dto.planIds,
          status: 'published',
          createdById: admin.sub,
          items: {
            create: {
              match: `${result.homeTeam} vs ${result.awayTeam}`,
              prediction: `${result.bestMarket}: ${result.bestSelection}`,
              matchDateTime: result.kickoff,
            },
          },
        },
      });

      await tx.analysisResult.update({
        where: { id },
        data: {
          status: 'published',
          predictionPostId: created.id,
          reviewedById: admin.sub,
          reviewedAt: new Date(),
        },
      });

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
