import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, errorResponse } from '@/lib/rbac';
import { verifyTotpCode } from '@/lib/twofactor';
import { writeAudit } from '@/lib/audit';
import { checkRateLimit, bootstrapVerifyLimiter, getClientIp } from '@/lib/ratelimit';
import { requireSameOrigin, requireCsrf } from '@/lib/csrf';
import { consumePending, hasSuperAdmin } from '@/lib/superadmin-setup';
import { redis } from '@/lib/redis';

export const runtime = 'nodejs';

// Only one superadmin may ever exist, but "check hasSuperAdmin() then
// create()" is a classic TOCTOU race: two bootstrap completions submitted
// close together could both read `exists: false` before either commits,
// and both create a superadmin. A count() and a create() are two separate
// round-trips with no atomicity between them. An actual unique DB
// constraint on role='superadmin' would be the most bulletproof fix, but
// that needs a partial index Prisma can't express directly; a real
// distributed lock (already-available Redis, same instance rate limiting
// and FX caching use) closes the same gap without a schema migration —
// only one request can hold LOCK_KEY at a time, so the recheck-then-create
// below is now a genuine critical section instead of a racy read-then-write.
const LOCK_KEY = 'superadmin-bootstrap-lock';
const LOCK_TTL_SECONDS = 30;

export async function POST(req: NextRequest) {
  let lockHeld = false;
  try {
    const exists = await hasSuperAdmin();
    if (exists) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    requireSameOrigin(req);
    requireCsrf(req);

    const ip = getClientIp(req);
    const allowed = await checkRateLimit(bootstrapVerifyLimiter, [ip]);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 });
    }

    const id = req.nextUrl.searchParams.get('id');
    const pending = await consumePending(id || '');
    if (!pending) {
      throw new ApiError(400, 'Bootstrap session expired or not found. Start again.');
    }

    const { code } = (await req.json()) as { code?: string };
    if (!code || code.length !== 6) {
      throw new ApiError(400, 'Enter the 6-digit code from your authenticator app');
    }

    if (!verifyTotpCode(pending.encryptedSecret, code)) {
      await writeAudit({
        actorId: 'bootstrap',
        action: 'auth.2fa_failed',
        metadata: { stage: 'bootstrap', email: pending.email, ip },
      });
      throw new ApiError(400, 'Invalid code');
    }

    const lockAcquired = await redis.set(LOCK_KEY, '1', { nx: true, ex: LOCK_TTL_SECONDS });
    if (!lockAcquired) {
      throw new ApiError(409, 'A super admin is already being created by another request. Please wait a moment and check whether setup completed.');
    }
    lockHeld = true;

    // Re-check now that the lock is actually held — the earlier check at
    // the top of this function was still just a plain read, only useful
    // for the fast-path "someone already finished setup entirely" case.
    // This is the check that actually matters for correctness.
    const stillNone = !(await hasSuperAdmin());
    if (!stillNone) {
      throw new ApiError(404, 'Not found');
    }

    const user = await prisma.user.create({
      data: {
        name: pending.name,
        email: pending.email,
        passwordHash: pending.passwordHash,
        country: 'Nigeria',
        role: 'superadmin',
        twoFactorSecret: pending.encryptedSecret,
        twoFactorEnabled: true,
        permissions: [],
        grantedBy: 'system',
        grantedAt: new Date(),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        twoFactorEnabled: true,
        createdAt: true,
      },
    });

    await writeAudit({
      actorId: user.id,
      action: 'auth.superadmin_created',
      targetId: user.id,
      metadata: { email: user.email, ip },
    });

    return NextResponse.json({ ok: true, user });
  } catch (err) {
    return errorResponse(err);
  } finally {
    if (lockHeld) await redis.del(LOCK_KEY);
  }
}
