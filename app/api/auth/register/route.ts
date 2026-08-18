import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/password';
import { checkRateLimit, authLimiter, getClientIp, normalizeIdentifier } from '@/lib/ratelimit';
import { errorResponse, ApiError } from '@/lib/rbac';
import { RegisterSchema } from '@/lib/schemas';
import { writeAudit } from '@/lib/audit';
import { sendEmail } from '@/lib/email';
import crypto from 'crypto';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json();
    const { name, email, phone, password, country } = RegisterSchema.parse(rawBody);

    const ip = getClientIp(req);
    const emailIdentifier = normalizeIdentifier('email', email);

    const allowed = await checkRateLimit(authLimiter, [ip, emailIdentifier]);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many attempts, try again shortly' }, { status: 429 });
    }

    const passwordHash = await hashPassword(password);
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h TTL

    const user = await prisma.user.create({
      data: {
        name,
        email,
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
      metadata: { email, country },
    });

    const verificationUrl = `${process.env.APP_URL}/verify-email?token=${token}`;
    try {
      await sendEmail({
        to: user.email,
        subject: 'Verify your PredictPro account',
        html: `<p>Welcome to PredictPro! Click the link below to verify your email address.</p><p><a href="${verificationUrl}">${verificationUrl}</a></p><p>This link expires in 24 hours.</p>`,
      });
    } catch (emailErr) {
      console.error('Failed to send verification email', emailErr);
    }

    return NextResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      message: 'Account created. Please check your email to verify your account.',
    });
  } catch (err) {
    return errorResponse(err);
  }
}
