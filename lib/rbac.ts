import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { verifyAccessToken, AccessTokenPayload } from './auth';
import { prisma } from './prisma';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
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

/** Replaces NestJS's RolesGuard + @Roles('admin'). */
export async function requireAdmin(req: NextRequest): Promise<AccessTokenPayload> {
  const user = await requireUser(req);
  if (user.role !== 'admin') throw new ApiError(403, 'Insufficient permissions');
  return user;
}

/**
 * Requires admin access AND enforces 2FA for admin accounts.
 * Use for sensitive admin operations.
 */
export async function requireAdminWith2FA(req: NextRequest): Promise<AccessTokenPayload> {
  const admin = await requireAdmin(req);
  const user = await prisma.user.findUnique({ where: { id: admin.sub }, select: { twoFactorEnabled: true } });
  if (!user?.twoFactorEnabled) {
    throw new ApiError(403, 'Admin account requires two-factor authentication');
  }
  return admin;
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

