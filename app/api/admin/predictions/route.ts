import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requirePermission, errorResponse } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { writeAudit } from '@/lib/audit';
import { requireCsrf } from '@/lib/csrf';
import { parsePagination, withPaginationHeaders } from '@/lib/pagination';

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

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, PERMISSIONS.pages.predictions);
    const { page, pageSize, offset } = parsePagination(req);

    const posts = await prisma.predictionPost.findMany({
      orderBy: { createdAt: 'desc' },
      include: { items: true, media: true },
      skip: offset,
      take: pageSize,
    });

    const total = await prisma.predictionPost.count();

    const res = NextResponse.json(posts);
    return withPaginationHeaders(res, page, pageSize, total);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    requireCsrf(req);
    const admin = await requirePermission(req, PERMISSIONS.pages.predictions);
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
