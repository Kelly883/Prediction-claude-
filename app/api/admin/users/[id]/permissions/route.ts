import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin, errorResponse, ApiError } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { PERMISSIONS } from '@/lib/permissions';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const superAdmin = await requireSuperAdmin(req);
    const { id } = await params;
    const body = await req.json();

    const { role, permissions } = body as {
      role?: 'admin' | 'superadmin';
      permissions?: string[];
    };

    if (!id) {
      throw new ApiError(400, 'User ID is required');
    }

    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, name: true, email: true },
    });

    if (!targetUser) {
      throw new ApiError(404, 'User not found');
    }

    if (targetUser.id === superAdmin.sub) {
      throw new ApiError(400, 'You cannot modify your own permissions');
    }

    if (targetUser.role === 'superadmin') {
      throw new ApiError(403, 'Cannot modify another super admin');
    }

    if (role === 'superadmin') {
      throw new ApiError(403, 'Cannot assign superadmin role. Only one super admin is allowed.');
    }

    if (role === 'admin' && Array.isArray(permissions)) {
      const invalidPerms = permissions.filter((p) => !Object.values(PERMISSIONS).includes(p as any));
      if (invalidPerms.length > 0) {
        throw new ApiError(400, `Invalid permissions: ${invalidPerms.join(', ')}`);
      }
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        role: role ?? targetUser.role,
        permissions: role === 'admin' && Array.isArray(permissions) ? permissions : [],
        grantedBy: superAdmin.sub,
        grantedAt: new Date(),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        permissions: true,
        grantedBy: true,
        grantedAt: true,
      },
    });

    await writeAudit({
      actorId: superAdmin.sub,
      action: 'admin.permission_change',
      targetId: updated.id,
      metadata: {
        targetEmail: updated.email,
        newRole: updated.role,
        newPermissions: updated.permissions,
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    return errorResponse(err);
  }
}
