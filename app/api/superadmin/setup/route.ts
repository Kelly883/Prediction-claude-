import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { ApiError, errorResponse } from '@/lib/rbac';
import { checkRateLimit, bootstrapLimiter, getClientIp } from '@/lib/ratelimit';
import { requireSameOrigin, requireCsrf } from '@/lib/csrf';
import { hasSuperAdmin, setPending } from '@/lib/superadmin-setup';
import { hashPassword } from '@/lib/password';
import { generateSecret, generateOtpAuthUri } from '@/lib/twofactor';
import { encryptTotpSecret } from '@/lib/encryption';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const exists = await hasSuperAdmin();
    return NextResponse.json({ exists });
  } catch {
    return NextResponse.json({ exists: false }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const exists = await hasSuperAdmin();
    if (exists) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    requireSameOrigin(req);
    requireCsrf(req);

    const ip = getClientIp(req);
    const allowed = await checkRateLimit(bootstrapLimiter, [ip]);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 });
    }

    const body = await req.json();
    const { name, email, password } = body as { name?: string; email?: string; password?: string };

    if (!name || !email || !password) {
      throw new ApiError(400, 'Name, email, and password are required');
    }

    if (password.length < 12) {
      throw new ApiError(400, 'Password must be at least 12 characters');
    }
    if (!/[A-Z]/.test(password)) throw new ApiError(400, 'Password must include an uppercase letter');
    if (!/[a-z]/.test(password)) throw new ApiError(400, 'Password must include a lowercase letter');
    if (!/[0-9]/.test(password)) throw new ApiError(400, 'Password must include a number');

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ApiError(409, 'An account with this email already exists');
    }

    const passwordHash = await hashPassword(password);
    const secret = generateSecret();
    const encryptedSecret = encryptTotpSecret(secret);

    const id = crypto.randomUUID();
    await setPending(id, { name, email, passwordHash, encryptedSecret });

    const otpauthUri = generateOtpAuthUri(secret, email);

    await writeAudit({
      actorId: 'bootstrap',
      action: 'auth.superadmin_bootstrap_started',
      metadata: { email, ip },
    });

    return NextResponse.json({ id, secret, otpauthUri });
  } catch (err) {
    return errorResponse(err);
  }
}
