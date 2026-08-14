import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, errorResponse } from '@/lib/rbac';
import { UpdateProfileSchema } from '@/lib/schemas';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const record = await prisma.user.findUniqueOrThrow({ where: { id: user.sub } });
    return NextResponse.json({ id: record.id, name: record.name, email: record.email, phone: record.phone, country: record.country, role: record.role });
  } catch (err) {
    return errorResponse(err);
  }
}

// Deliberately narrow: only `name` and `phone` are editable here. Email
// changes need re-verification (out of scope for this pass) and
// role/passwordHash/twoFactorSecret must never be settable through a
// self-service endpoint — UpdateProfileSchema enforces that shape, but the
// comment's here so nobody "helpfully" widens this to `data: body` later.
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const dto = UpdateProfileSchema.parse(await req.json());
    const record = await prisma.user.update({ where: { id: user.sub }, data: dto });
    return NextResponse.json({ id: record.id, name: record.name, email: record.email, phone: record.phone, country: record.country, role: record.role });
  } catch (err) {
    return errorResponse(err);
  }
}
