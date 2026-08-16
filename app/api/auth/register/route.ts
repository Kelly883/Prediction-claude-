import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/password';
import { checkRateLimit, authLimiter, getClientIp, normalizeIdentifier } from '@/lib/ratelimit';
import { errorResponse, ApiError } from '@/lib/rbac';
import { RegisterSchema } from '@/lib/schemas';
import { writeAudit } from '@/lib/audit';
import crypto from 'crypto';

export const runtime = 'nodejs';

function generateVerificationToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

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
    const token = generateVerificationToken();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const user = await prisma.user
      .create({
        data: {
          name,
          email,
          phone,
          passwordHash,
          country,
          emailVerifiedAt: null,
          emailVerificationTokens: {
            create: {
              tokenHash,
              expiresAt,
            },
          },
        },
        select: { id: true, name: true, email: true },
      })
      .catch((err: any) => {
        if (err?.code === 'P2002') throw new ApiError(409, 'An account with this email already exists');
        throw err;
      });

    await writeAudit({
      actorId: user.id,
      action: 'user.registered',
      targetId: user.id,
      metadata: { email, country, ip },
    });

    return NextResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      message: 'Account created. Please verify your email.',
      // In production, send verification email with link:
      // /api/auth/verify-email?token=<token>
      verificationToken: token, // Remove in production; use email service instead
    });
  } catch (err) {
    return errorResponse(err);
  }
}
