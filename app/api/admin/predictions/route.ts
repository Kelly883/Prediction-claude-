import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin, errorResponse } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { requireCsrf } from '@/lib/csrf';

export const runtime = 'nodejs';

const PredictionItemSchema = z.object({
  match: z.string(),
  prediction: z.string(),
  matchDateTime: z.string().datetime().optional(),
});

const CreatePredictionSchema = z.object({
  title: z.string(),
  scheduledAt: z.string().datetime(),
  categoryIds: z.array(z.string()).optional(),
  bookingCode: z.string(),
  bodyNotes: z.string().optional(),
  visibility: z.enum(['plan_specific', 'subscribers', 'free_window']),
  freeUntil: z.string().datetime().optional(),
  planIds: z.array(z.string()).optional(),
  items: z.array(PredictionItemSchema),
});

export async function POST(req: NextRequest) {
  try {
    requireCsrf(req);
    const admin = await requireAdmin(req);
    const dto = CreatePredictionSchema.parse(await req.json());

    const post = await prisma.predictionPost.create({
      data: {
        title: dto.title,
        scheduledAt: new Date(dto.scheduledAt),
        categoryIds: dto.categoryIds ?? [],
        bookingCode: dto.bookingCode,
        bodyNotes: dto.bodyNotes,
        visibility: dto.visibility,
        freeUntil: dto.freeUntil ? new Date(dto.freeUntil) : undefined,
        planIds: dto.planIds ?? [],
        status: 'draft',
        createdById: admin.sub,
        items: { create: dto.items.map((i) => ({ ...i, matchDateTime: i.matchDateTime ? new Date(i.matchDateTime) : undefined })) },
      },
    });

    await writeAudit({ actorId: admin.sub, action: 'prediction.create', targetId: post.id });
    return NextResponse.json(post);
  } catch (err) {
    return errorResponse(err);
  }
}
