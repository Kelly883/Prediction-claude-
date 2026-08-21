import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin, errorResponse, ApiError } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { PERMISSIONS, ALL_PERMISSIONS } from '@/lib/permissions';
import { requireSameOrigin, requireCsrf } from '@/lib/csrf';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(req);
    requireCsrf(req);
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
      select: { id: true, role: true, name: true, email: true, deletedAt: true },
    });

    if (!targetUser) {
      throw new ApiError(404, 'User not found');
    }

    if (targetUser.deletedAt) {
      throw new ApiError(400, 'Cannot modify a deactivated user');
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
      const invalidPerms = permissions.filter((p) => !ALL_PERMISSIONS.includes(p as any));
      if (invalidPerms.length > 0) {
        throw new ApiError(400, `Invalid permissions: ${invalidPerms.join(', ')}`);
      }
    }

    const effectiveRole = role ?? targetUser.role;

    const updated = await prisma.user.update({
      where: { id },
      data: {
        // `effectiveRole` fixes a real bug: the permissions conditional
        // below previously checked the raw request field `role` directly,
        // not what the user's role would actually become after applying
        // the `role ?? targetUser.role` fallback used for the `role` write
        // itself. A caller updating only `permissions` for an existing
        // admin — reasonably omitting `role` since it isn't changing —
        // would silently have their permissions wiped to [], because the
        // (undefined) input `role` didn't literally equal 'admin', even
        // though the account was an admin both before and after this
        // update. Not yet reachable from any shipped UI (the only current
        // frontend caller is read-only), but a real trap for the actual
        // "update this admin's permissions" feature this endpoint exists
        // for.
        role: effectiveRole,
        permissions: effectiveRole === 'admin' && Array.isArray(permissions) ? permissions : [],
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
