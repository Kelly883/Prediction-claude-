import { SignJWT, jwtVerify } from 'jose';

// jose (not jsonwebtoken) because it works in both the Node.js runtime and
// the Edge runtime without native bindings — needed since middleware.ts
// checks auth at the edge. Password hashing (bcryptjs, NOT edge-compatible)
// lives in lib/password.ts instead — see the comment there for why that
// split matters, not just style preference.

const encoder = new TextEncoder();

/**
 * SECURITY: TextEncoder.encode(undefined) silently produces an empty-string
 * key, not an error — so if JWT_ACCESS_SECRET is ever missing in production
 * (a misconfigured deploy, a typo'd env var name), every token gets signed
 * with an empty HMAC key, which anyone can forge, including admin sessions.
 * Fail loudly instead of failing open at request time.
 */
function requireSecret(name: string, value: string | undefined): Uint8Array {
  if (!value || value.length < 32) {
    throw new Error(`Missing or undersized JWT secret: ${name}. Set a value >= 32 characters.`);
  }
  return encoder.encode(value);
}

function getAccessSecret(): Uint8Array {
  return requireSecret('JWT_ACCESS_SECRET', process.env.JWT_ACCESS_SECRET);
}

function getRefreshSecret(): Uint8Array {
  return requireSecret(
    'JWT_REFRESH_SECRET (or JWT_ACCESS_SECRET as fallback)',
    process.env.JWT_REFRESH_SECRET ?? process.env.JWT_ACCESS_SECRET,
  );
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

// In-memory store for used refresh token jti's (rotation detection).
// In production, replace with Redis with TTL matching refresh token lifetime.
export const usedRefreshJtis = new Set<string>();

export async function issueAccessToken(payload: AccessTokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(process.env.JWT_ACCESS_TTL ?? '15m')
    .sign(getAccessSecret());
}

export async function issueRefreshToken(userId: string, tokenVersion: number = 0): Promise<string> {
  const { randomUUID } = await import('crypto');
  const jti = randomUUID();
  return new SignJWT({ sub: userId, type: 'refresh', tv: tokenVersion, jti })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(process.env.JWT_REFRESH_TTL ?? '7d')
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
    if (jti && usedRefreshJtis.has(jti)) {
      return null;
    }

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
