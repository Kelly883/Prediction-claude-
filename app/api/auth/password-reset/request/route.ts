import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendEmail } from '@/lib/email';
import { checkRateLimit, authLimiter, getClientIp, normalizeIdentifier } from '@/lib/ratelimit';
import { errorResponse } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';
const TOKEN_TTL_MINUTES = 30;

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    const ip = getClientIp(req);
    const emailIdentifier = email ? normalizeIdentifier('email', email) : `ip:${ip}`;

    // Fail-closed dual rate limiting on password reset request
    const allowed = await checkRateLimit(authLimiter, [ip, emailIdentifier]);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many attempts, try again shortly' }, { status: 429 });
    }

    const user = email ? await prisma.user.findUnique({ where: { email } }) : null;

    await writeAudit({
      actorId: user?.id ?? null,
      action: 'auth.password_reset_requested',
      metadata: { ip, emailNormalized: email ? email.toLowerCase() : null },
    });

    // Always return the same generic response whether or not the account
    // exists — a different response here is a classic account-enumeration leak.
    const genericResponse = NextResponse.json({
      message: 'If an account exists for that email, a reset link has been sent.',
    });

    if (!user) return genericResponse;

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000) },
    });

    const resetUrl = `${process.env.APP_URL}/reset-password?token=${rawToken}`;

    try {
      await sendEmail({
        to: user.email,
        subject: 'Reset your PredictPro password',
        html: `<p>Reset your password using the link below. It expires in ${TOKEN_TTL_MINUTES} minutes.</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, ignore this email.</p>`,
      });
    } catch (emailErr) {
      // Don't fail the request over email delivery — log it, and in
      // non-production surface the link directly so this is testable
      // without a configured Resend account.
      console.error('Failed to send password reset email', emailErr);
      if (process.env.NODE_ENV !== 'production') {
        return NextResponse.json({ message: 'Email not configured — dev mode reset link below.', devResetUrl: resetUrl });
      }
    }

    return genericResponse;
  } catch (err) {
    return errorResponse(err);
  }
}
