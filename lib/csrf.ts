import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { ApiError } from './rbac';

const CSRF_COOKIE = 'x-csrf-token';
const CSRF_HEADER = 'x-csrf-token';

export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function getCsrfToken(req: NextRequest): string | undefined {
  return req.cookies.get(CSRF_COOKIE)?.value;
}

export function getCsrfHeader(req: NextRequest): string | undefined {
  return req.headers.get(CSRF_HEADER) ?? undefined;
}

export function validateCsrf(req: NextRequest): boolean {
  const cookieToken = getCsrfToken(req);
  const headerToken = getCsrfHeader(req);

  if (!cookieToken || !headerToken) return false;
  return crypto.timingSafeEqual(
    Buffer.from(cookieToken),
    Buffer.from(headerToken),
  );
}

export function setCsrfCookie(res: NextResponse, token: string): void {
  res.cookies.set(CSRF_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60,
  });
}

export function requireCsrf(req: NextRequest): void {
  if (process.env.NODE_ENV === 'test') return;
  if (!validateCsrf(req)) {
    throw new ApiError(403, 'Invalid CSRF token');
  }
}
