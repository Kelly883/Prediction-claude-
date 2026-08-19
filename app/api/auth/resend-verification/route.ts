import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendVerificationEmail } from '@/lib/emails';
import { checkRateLimit, authLimiter, getClientIp, normalizeIdentifier } from '@/lib/ratelimit';
import { errorResponse } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';
const TOKEN_TTL_HOURS = 24;

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    const ip = getClientIp(req);
    const normalizedEmail = email ? email.trim().toLowerCase() : '';
    const emailIdentifier = normalizedEmail ? normalizeIdentifier('email', normalizedEmail) : `ip:${ip}`;

    const allowed = await checkRateLimit(authLimiter, [ip, emailIdentifier]);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many attempts, try again shortly' }, { status: 429 });
    }

    const genericResponse = (emailSent: boolean) => NextResponse.json({
      message: "If an account exists for that email and isn't already verified, a new verification link has been sent.",
      emailSent,
    });

    const user = normalizedEmail ? await prisma.user.findUnique({ where: { email: normalizedEmail } }) : null;
    if (!user || user.deletedAt || user.emailVerifiedAt) {
      return genericResponse(false);
    }

    let emailSent = false;
    await prisma.$transaction(async (db) => {
      await db.emailVerificationToken.updateMany({
        where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });

      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

      await db.emailVerificationToken.create({
        data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000) },
      });

      const verificationUrl = `${process.env.APP_URL}/verify-email?token=${rawToken}`;
      try {
        await sendVerificationEmail(user.email, verificationUrl);
        emailSent = true;
      } catch (emailErr) {
        console.error('Failed to send verification email', emailErr);
        if (process.env.NODE_ENV !== 'production') {
          return NextResponse.json({ message: 'Email not configured — dev mode verification link below.', devVerificationUrl: verificationUrl, emailSent: true });
        }
      }
    });

    await writeAudit({
      action: 'auth.email_verification_resent',
      targetId: user.id,
      metadata: { email: normalizedEmail, emailSent },
    });

    return genericResponse(emailSent);
  } catch (err) {
    return errorResponse(err);
  }
}
