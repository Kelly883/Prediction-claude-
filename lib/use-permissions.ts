'use client';

import { useDashboardUser } from './dashboard-user-context';
import type { Permission } from './permissions';

export function useHasPermission(permission: Permission): boolean {
  const { user } = useDashboardUser();
  if (!user) return false;
  if (user.role === 'superadmin') return true;
  return user.permissions.includes(permission);
}
