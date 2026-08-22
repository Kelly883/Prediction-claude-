import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/password';
import { checkRateLimit, adminLimiter, getClientIp } from '@/lib/ratelimit';
import { errorResponse, ApiError } from '@/lib/rbac';
import { RegisterSchema } from '@/lib/schemas';
import { issueAccessToken, issueRefreshToken, cookieOptions } from '@/lib/auth';
import { touchSession } from '@/lib/sessions';
import { writeAudit } from '@/lib/audit';
import { timingSafeStringEqual } from '@/lib/timing-safe';

export const runtime = 'nodejs';

function verifyBootstrapSecret(req: NextRequest): boolean {
  const secret = process.env.ADMIN_BOOTSTRAP_SECRET;
  if (!secret) {
    return false;
  }

  const headerSecret =
    req.headers.get('x-admin-bootstrap-secret') ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

  if (!headerSecret) return false;
  return timingSafeStringEqual(headerSecret, secret);
}

export async function GET(req: NextRequest) {
  try {
    const hasSecretConfigured = Boolean(process.env.ADMIN_BOOTSTRAP_SECRET);

    if (!hasSecretConfigured) {
      return NextResponse.json({
        isSetupAvailable: false,
        message: 'Bootstrap secret is not configured.',
      });
    }

    const adminCount = await prisma.user.count({ where: { role: 'admin' } });
    const isSetupAvailable = adminCount === 0 && verifyBootstrapSecret(req);

    return NextResponse.json({
      isSetupAvailable,
    });
  } catch (err) {
    return NextResponse.json({ isSetupAvailable: false, error: 'Database unavailable' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  try {
    const allowed = await checkRateLimit(adminLimiter, ip);
    if (!allowed) {
      await writeAudit({
        action: 'auth.admin_bootstrap_rejected',
        metadata: { ip, reason: 'rate_limited' },
      });
      return NextResponse.json({ error: 'Too many attempts, try again shortly' }, { status: 429 });
    }

    // Enforce production bootstrap secret verification
    const isAuthorized = verifyBootstrapSecret(req);
    if (!isAuthorized) {
      await writeAudit({
        action: 'auth.admin_bootstrap_rejected',
        metadata: { ip, reason: 'unauthorized_bootstrap_secret' },
      });
      throw new ApiError(403, 'Admin setup requires a valid bootstrap secret.');
    }

    const { name, email, phone, password, country } = RegisterSchema.parse(await req.json());
    const passwordHash = await hashPassword(password);

    // ATOMIC CREATION & CONCURRENCY CONTROL:
    // Run within a Prisma transaction to eliminate race conditions between concurrent requests.
    const admin = await prisma.$transaction(async (db) => {
      const existingAdminCount = await db.user.count({ where: { role: 'admin' } });
      if (existingAdminCount > 0) {
        throw new ApiError(403, 'Administrator account has already been registered. Initial setup is deactivated.');
      }

      return db.user.create({
        data: {
          name,
          email,
          phone,
          passwordHash,
          country,
          role: 'admin',
        },
      });
    });

    // Do NOT auto-login — require the operator to set a password before
    // issuing a session. The client should redirect to /login after setup.
    const res = NextResponse.json({
      success: true,
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      requirePasswordChange: true,
    });

    return res;
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      await writeAudit({
        action: 'auth.admin_bootstrap_rejected',
        metadata: { ip, error: err.message },
      });
    }
    return errorResponse(err);
  }
}
