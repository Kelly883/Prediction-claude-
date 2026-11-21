import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { requireAnalysisAdmin } from '@/lib/analysis/api-auth';
import { validateConfigUpdate } from '@/lib/analysis/config';

export const runtime = 'nodejs';

const UpdateConfigSchema = z.object({
  updates: z.array(z.object({ key: z.string(), value: z.unknown() })).min(1),
});

export async function GET(req: NextRequest) {
  try {
    await requireAnalysisAdmin(req);
    const configs = await prisma.analysisConfig.findMany({ orderBy: { key: 'asc' } });
    return NextResponse.json(configs);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireAnalysisAdmin(req, true);
    const body = await req.json() as { key?: string; value?: unknown; updates?: unknown };
    const dto = Array.isArray(body.updates)
      ? UpdateConfigSchema.parse(body)
      : UpdateConfigSchema.parse({ updates: [{ key: body.key, value: body.value }] });

    const validated = dto.updates.map((update) => ({
      key: update.key,
      value: validateConfigUpdate(update.key, update.value) as Prisma.InputJsonValue,
    }));

    const updated = [];
    for (const update of validated) {
      const record = await prisma.analysisConfig.upsert({
        where: { key: update.key },
        create: {
          key: update.key,
          value: update.value,
          updatedById: admin.sub,
        },
        update: {
          value: update.value,
          updatedById: admin.sub,
        },
      });
      updated.push(record);
      await writeAudit({
        actorId: admin.sub,
        action: 'analysis.config.update',
        targetType: 'analysis_config',
        targetId: record.id,
        metadata: { key: update.key, value: update.value },
      });
    }

    return NextResponse.json({ configs: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
