import { SignJWT, jwtVerify } from 'jose';
import { getEnv } from '@/lib/env';

const encoder = new TextEncoder();

function getAccessSecret(): Uint8Array {
  const secret = getEnv().JWT_ACCESS_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('Missing or undersized JWT secret: JWT_ACCESS_SECRET. Set a value >= 32 characters.');
  }
  return encoder.encode(secret);
}

function getRefreshSecret(): Uint8Array {
  const env = getEnv();
  const secret = env.JWT_REFRESH_SECRET || env.JWT_ACCESS_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('Missing or undersized JWT secret: JWT_REFRESH_SECRET. Set a value >= 32 characters.');
  }
  return encoder.encode(secret);
}

export interface AccessTokenPayload {
  sub: string;
  role: 'admin' | 'user' | 'superadmin';
}

export interface RefreshTokenPayload {
  sub: string;
  tv?: number; // tokenVersion / session version
  jti?: string; // refresh token ID for rotation/reuse detection
}

// NOTE: refresh-token JTI rotation/reuse detection deliberately does NOT live
// here. This module is imported by middleware.ts on the Edge runtime, where
// there is no shared memory or Redis client — an in-process Set would give a
// false sense of security across serverless instances. Reuse detection now
// happens in the Node-runtime refresh route via lib/refresh-jti.ts (Redis,
// claim-on-consume semantics). verifyRefreshToken below only validates
// signature, expiry, and the `type` claim.

export async function issueAccessToken(payload: AccessTokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(getEnv().JWT_ACCESS_TTL)
    .sign(getAccessSecret());
}

export async function issueRefreshToken(userId: string, tokenVersion: number = 0): Promise<string> {
  const { randomUUID } = await import('crypto');
  const jti = randomUUID();
  return new SignJWT({ sub: userId, type: 'refresh', tv: tokenVersion, jti })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(getEnv().JWT_REFRESH_TTL)
    .sign(getRefreshSecret());
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getAccessSecret());
    return { sub: payload.sub as string, role: payload.role as 'admin' | 'user' | 'superadmin' };
  } catch {
    return null;
  }
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getRefreshSecret());
    if (payload.type !== 'refresh') return null;

    const jti = typeof payload.jti === 'string' ? payload.jti : undefined;

    return { sub: payload.sub as string, tv: typeof payload.tv === 'number' ? payload.tv : undefined, jti };
  } catch {
    return null;
  }
}

// Short-lived token identifying "this person passed step 1 (password) of
// login and now needs to complete step 2 (TOTP code)". Deliberately NOT an
// access token — it grants no API access on its own, only the ability to
// complete the second login step at /api/auth/2fa/login-verify.
export async function issueTwoFactorChallengeToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId, type: 'two_factor_challenge' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(getAccessSecret());
}

export async function verifyTwoFactorChallengeToken(token: string): Promise<{ sub: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getAccessSecret());
    if (payload.type !== 'two_factor_challenge') return null;
    return { sub: payload.sub as string };
  } catch {
    return null;
  }
}

// Cookie attributes matching design doc Section 7: HTTPOnly/Secure/SameSite.
// `secure: true` requires HTTPS, which Vercel provides by default in every
// environment (including preview deployments), so this is safe to hardcode.
export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}
