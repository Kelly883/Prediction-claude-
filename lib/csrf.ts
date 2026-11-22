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

  // crypto.timingSafeEqual throws (rather than returning false) when the two
  // buffers differ in length, which would surface as a 500 instead of a clean
  // 403. Length is not secret-dependent, so revealing a mismatch here is safe.
  const cookieBuf = Buffer.from(cookieToken);
  const headerBuf = Buffer.from(headerToken);
  if (cookieBuf.length !== headerBuf.length) return false;
  return crypto.timingSafeEqual(cookieBuf, headerBuf);
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

export function requireSameOrigin(req: NextRequest): void {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  // Fail closed for state-changing methods: browsers always send Origin on
  // POST/PATCH/PUT/DELETE, so a missing Origin on those is not a browser
  // request and must be rejected. For GET/HEAD the Origin header is NOT sent
  // by browsers on same-origin navigations, so requiring it there would break
  // every read endpoint (the analysis dashboard GETs, admin lists, etc.).
  // Tests call route handlers directly with no Origin header, so
  // NODE_ENV==='test' skips the missing-header rejection for mutations too.
  const method = (req.method ?? 'GET').toUpperCase();
  const isMutation = method !== 'GET' && method !== 'HEAD';
  if (!origin || !host) {
    if (isMutation && process.env.NODE_ENV !== 'test') {
      throw new ApiError(403, 'Forbidden: missing Origin header');
    }
    return;
  }
  try {
    const originHost = new URL(origin).host;
    if (originHost !== host) {
      throw new ApiError(403, 'Forbidden cross-origin request');
    }
  } catch {
    throw new ApiError(403, 'Forbidden cross-origin request');
  }
}
