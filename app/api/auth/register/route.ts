import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/password';
import { checkRateLimit, authLimiter, getClientIp, normalizeIdentifier } from '@/lib/ratelimit';
import { errorResponse, ApiError } from '@/lib/rbac';
import { RegisterSchema } from '@/lib/schemas';
import { writeAudit } from '@/lib/audit';
import { sendVerificationEmail } from '@/lib/emails';
import crypto from 'crypto';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json();
    const { name, email, phone, password, country } = RegisterSchema.parse(rawBody);

    const normalizedEmail = email.trim().toLowerCase();
    const ip = getClientIp(req);
    const emailIdentifier = normalizeIdentifier('email', normalizedEmail);

    const allowed = await checkRateLimit(authLimiter, [ip, emailIdentifier]);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many attempts, try again shortly' }, { status: 429 });
    }

    const passwordHash = await hashPassword(password);
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h TTL

    const user = await prisma.user.create({
      data: {
        name,
        email: normalizedEmail,
        phone,
        passwordHash,
        country,
        emailVerifiedAt: null,
        emailVerifications: {
          create: {
            tokenHash,
            expiresAt,
          },
        },
      },
      select: { id: true, name: true, email: true },
    });

    await writeAudit({
      action: 'auth.register',
      targetId: user.id,
      metadata: { email: normalizedEmail, country },
    });

    const verificationUrl = `${process.env.APP_URL}/verify-email?token=${rawToken}`;
    let emailSent = false;
    try {
      await sendVerificationEmail(user.email, verificationUrl);
      emailSent = true;
      await writeAudit({
        action: 'auth.email_verification_sent',
        targetId: user.id,
        metadata: { email: normalizedEmail },
      });
    } catch (emailErr) {
      console.error('Failed to send verification email', emailErr);
      await writeAudit({
        action: 'auth.email_verification_failed',
        targetId: user.id,
        metadata: { email: normalizedEmail, error: emailErr instanceof Error ? emailErr.message : 'unknown' },
      });
      if (process.env.NODE_ENV !== 'production') {
        return NextResponse.json({
          id: user.id,
          name: user.name,
          email: user.email,
          emailSent: true,
          message: 'Account created (dev mode). Verify with the link below.',
          devVerificationUrl: verificationUrl,
        });
      }
    }

    return NextResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      emailSent,
      message: emailSent
        ? 'Account created. Please check your email to verify your account.'
        : 'Account created, but we could not send the verification email. Please contact support or try again later.',
    });
  } catch (err) {
    return errorResponse(err);
  }
}
