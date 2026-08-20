import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { verifyAccessToken, AccessTokenPayload } from './auth';
import { prisma } from './prisma';
import { PERMISSIONS, type Permission } from './permissions';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface AuthenticatedUser extends AccessTokenPayload {
  permissions?: string[];
}

/**
 * Route handlers call this first. Throws ApiError(401) if there's no valid
 * session — the caller's try/catch (see lib/handler.ts) turns that into a
 * proper JSON error response. This replaces NestJS's JwtAuthGuard.
 */
export async function requireUser(req: NextRequest): Promise<AccessTokenPayload> {
  const token = req.cookies.get('access_token')?.value;
  if (!token) throw new ApiError(401, 'Missing session');

  const payload = await verifyAccessToken(token);
  if (!payload) throw new ApiError(401, 'Invalid or expired session');

  return payload; // { sub: userId, role }
}

/** Replaces NestJS's RolesGuard + @Roles('admin'). Superadmin is also allowed. */
export async function requireAdmin(req: NextRequest): Promise<AuthenticatedUser> {
  const user = await requireUser(req);
  if (user.role !== 'admin' && user.role !== 'superadmin') {
    throw new ApiError(403, 'Insufficient permissions');
  }
  const record = await prisma.user.findUnique({
    where: { id: user.sub },
    select: { permissions: true },
  });
  return { ...user, permissions: record?.permissions ?? [] };
}

/**
 * Requires admin or superadmin access AND enforces 2FA for admin accounts.
 * Use for sensitive admin operations.
 */
export async function requireAdminWith2FA(req: NextRequest): Promise<AuthenticatedUser> {
  const admin = await requireAdmin(req);
  const user = await prisma.user.findUnique({ where: { id: admin.sub }, select: { twoFactorEnabled: true } });
  if (!user?.twoFactorEnabled) {
    throw new ApiError(403, 'Admin account requires two-factor authentication');
  }
  return admin;
}

/** Requires superadmin role. */
export async function requireSuperAdmin(req: NextRequest): Promise<AuthenticatedUser> {
  const user = await requireUser(req);
  if (user.role !== 'superadmin') {
    throw new ApiError(403, 'Super admin access required');
  }
  const record = await prisma.user.findUnique({
    where: { id: user.sub },
    select: { permissions: true },
  });
  return { ...user, permissions: record?.permissions ?? [] };
}

/** Requires a specific permission. Superadmin bypasses all checks. */
export async function requirePermission(req: NextRequest, permission: Permission): Promise<AuthenticatedUser> {
  const user = await requireUser(req);
  if (user.role === 'superadmin') {
    const record = await prisma.user.findUnique({
      where: { id: user.sub },
      select: { permissions: true },
    });
    return { ...user, permissions: record?.permissions ?? [] };
  }
  if (user.role !== 'admin') {
    throw new ApiError(403, 'Insufficient permissions');
  }
  const record = await prisma.user.findUnique({
    where: { id: user.sub },
    select: { permissions: true, twoFactorEnabled: true },
  });
  if (!record?.permissions.includes(permission)) {
    throw new ApiError(403, `Missing permission: ${permission}`);
  }
  return { ...user, permissions: record.permissions };
}

/** Requires a specific permission AND enforces 2FA for admin accounts. */
export async function requirePermissionWith2FA(req: NextRequest, permission: Permission): Promise<AuthenticatedUser> {
  const user = await requireUser(req);
  if (user.role === 'superadmin') {
    const record = await prisma.user.findUnique({
      where: { id: user.sub },
      select: { permissions: true, twoFactorEnabled: true },
    });
    if (!record?.twoFactorEnabled) {
      throw new ApiError(403, 'Admin account requires two-factor authentication');
    }
    return { ...user, permissions: record?.permissions ?? [] };
  }
  if (user.role !== 'admin') {
    throw new ApiError(403, 'Insufficient permissions');
  }
  const record = await prisma.user.findUnique({
    where: { id: user.sub },
    select: { permissions: true, twoFactorEnabled: true },
  });
  if (!record?.permissions.includes(permission)) {
    throw new ApiError(403, `Missing permission: ${permission}`);
  }
  if (!record?.twoFactorEnabled) {
    throw new ApiError(403, 'Admin account requires two-factor authentication');
  }
  return { ...user, permissions: record.permissions };
}

/** Check if a user has a specific permission. Superadmin always has all permissions. */
export function hasPermission(user: { role: string; permissions: string[] }, permission: Permission): boolean {
  if (user.role === 'superadmin') return true;
  return user.permissions.includes(permission);
}

/** Optional auth — used by routes that behave differently for logged-out visitors. */
export async function optionalUser(req: NextRequest): Promise<AccessTokenPayload | null> {
  const token = req.cookies.get('access_token')?.value;
  if (!token) return null;
  return verifyAccessToken(token);
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof ZodError) {
    const message = err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    return NextResponse.json({ error: message }, { status: 400 });
  }
  console.error(err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

