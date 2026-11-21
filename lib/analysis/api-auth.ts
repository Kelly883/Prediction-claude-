import type { NextRequest } from 'next/server';
import { requireCsrf, requireSameOrigin } from '@/lib/csrf';
import { requireSuperAdmin, type AuthenticatedUser } from '@/lib/rbac';

export async function requireAnalysisAdmin(req: NextRequest, mutate = false): Promise<AuthenticatedUser> {
  requireSameOrigin(req);
  if (mutate) requireCsrf(req);
  return requireSuperAdmin(req);
}
