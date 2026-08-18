import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, errorResponse } from '@/lib/rbac';
import { requireSameOrigin, requireCsrf } from '@/lib/csrf';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    requireSameOrigin(req);
    requireCsrf(req);
    const admin = await requireAdmin(req);
    const users = await prisma.user.findMany({
      where: { role: 'user', deletedAt: null },
      select: { id: true, name: true, email: true, phone: true, country: true, createdAt: true },
    });

    // PRD Section 11: user exports must be audited.
    await writeAudit({ actorId: admin.sub, action: 'user.export', metadata: { count: users.length } });

    const header = 'id,name,email,phone,country,createdAt';
    const escapeCsv = (val: string) => `"${val.replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '')}"`;
    const rows = users.map((u: any) => `${u.id},${escapeCsv(u.name)},${u.email},${escapeCsv(u.phone ?? '')},${u.country},${u.createdAt instanceof Date ? u.createdAt.toISOString() : new Date(u.createdAt).toISOString()}`);
    return NextResponse.json({ csv: [header, ...rows].join('\n') });
  } catch (err) {
    return errorResponse(err);
  }
}
