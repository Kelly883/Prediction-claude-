import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, errorResponse, ApiError } from '@/lib/rbac';
import { requireCsrf } from '@/lib/csrf';
import { PERMISSIONS, ALL_PERMISSIONS } from '@/lib/permissions';
import { UpdateProfileSchema } from '@/lib/schemas';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const record = await prisma.user.findUniqueOrThrow({ where: { id: user.sub } });
    if (record.deletedAt) throw new ApiError(403, 'Account has been deactivated');
    const permissions = record.role === 'superadmin'
      ? ALL_PERMISSIONS
      : record.permissions;
    return NextResponse.json({ id: record.id, name: record.name, email: record.email, phone: record.phone, country: record.country, role: record.role, emailVerified: !!record.emailVerifiedAt, permissions });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    requireCsrf(req);
    const user = await requireUser(req);
    const dto = UpdateProfileSchema.parse(await req.json());
    const record = await prisma.user.update({ where: { id: user.sub }, data: dto });
    return NextResponse.json({ id: record.id, name: record.name, email: record.email, phone: record.phone, country: record.country, role: record.role });
  } catch (err) {
    return errorResponse(err);
  }
}
