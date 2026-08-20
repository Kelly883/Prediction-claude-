import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, errorResponse, ApiError } from '@/lib/rbac';
import { ALL_PERMISSIONS } from '@/lib/permissions';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const record = await prisma.user.findUnique({
      where: { id: user.sub },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        permissions: true,
        grantedBy: true,
        grantedAt: true,
        lastLoginAt: true,
        twoFactorEnabled: true,
        emailVerifiedAt: true,
        createdAt: true,
      },
    });

    if (!record) {
      throw new ApiError(403, 'Account has been deactivated');
    }

    const permissions = record.role === 'superadmin'
      ? ALL_PERMISSIONS
      : record.permissions;

    return NextResponse.json({
      id: record.id,
      name: record.name,
      email: record.email,
      role: record.role,
      permissions,
      grantedBy: record.grantedBy,
      grantedAt: record.grantedAt,
      lastLoginAt: record.lastLoginAt,
      twoFactorEnabled: record.twoFactorEnabled,
      emailVerifiedAt: record.emailVerifiedAt,
      createdAt: record.createdAt,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
