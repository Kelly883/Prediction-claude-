import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendEmail } from '@/lib/email';
import { checkRateLimit, authLimiter, getClientIp, normalizeIdentifier } from '@/lib/ratelimit';
import { errorResponse } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';
const TOKEN_TTL_HOURS = 24;

// Covers two cases: someone right after registration whose email either
// never arrived (RESEND_API_KEY/RESEND_FROM_EMAIL misconfigured, or lost/
// spam-filtered) or whose 24h token expired, and an existing account that
// was created before this endpoint existed and has just never verified.
// Deliberately unauthenticated and email-based (mirrors
// password-reset/request's pattern exactly) rather than requiring a
// session — right after registration there isn't one yet.
export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    const ip = getClientIp(req);
    const emailIdentifier = email ? normalizeIdentifier('email', email) : `ip:${ip}`;

    const allowed = await checkRateLimit(authLimiter, [ip, emailIdentifier]);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many attempts, try again shortly' }, { status: 429 });
    }

    // Always the same generic response regardless of whether the account
    // exists, is already verified, or was soft-deleted — a different
    // response for each case is a classic account-enumeration leak, same
    // reasoning as password-reset/request.
    const genericResponse = NextResponse.json({
      message: "If an account exists for that email and isn't already verified, a new verification link has been sent.",
    });

    const user = email ? await prisma.user.findUnique({ where: { email } }) : null;
    if (!user || user.deletedAt || user.emailVerifiedAt) {
      return genericResponse;
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await prisma.emailVerificationToken.create({
      data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000) },
    });

    await writeAudit({ actorId: user.id, action: 'auth.email_verification_resent' });

    const verificationUrl = `${process.env.APP_URL}/verify-email?token=${rawToken}`;

    try {
      await sendEmail({
        to: user.email,
        subject: 'Verify your PredictPro account',
        html: `<p>Click the link below to verify your email address.</p><p><a href="${verificationUrl}">${verificationUrl}</a></p><p>This link expires in ${TOKEN_TTL_HOURS} hours.</p>`,
      });
    } catch (emailErr) {
      // Same reasoning as password-reset/request: don't fail the request
      // over email delivery, and in non-production surface the link
      // directly so this is testable without a configured Resend account.
      console.error('Failed to send verification email', emailErr);
      if (process.env.NODE_ENV !== 'production') {
        return NextResponse.json({ message: 'Email not configured — dev mode verification link below.', devVerificationUrl: verificationUrl });
      }
    }

    return genericResponse;
  } catch (err) {
    return errorResponse(err);
  }
}
