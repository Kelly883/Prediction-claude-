import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin, errorResponse } from '@/lib/rbac';
import { ALL_PERMISSIONS, PERMISSION_LABELS, PERMISSION_GROUPS, NAV_PERMISSIONS } from '@/lib/permissions';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    return NextResponse.json({
      permissions: ALL_PERMISSIONS,
      labels: PERMISSION_LABELS,
      groups: PERMISSION_GROUPS,
      navMapping: NAV_PERMISSIONS,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
