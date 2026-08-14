import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/password';
import { checkRateLimit, authLimiter } from '@/lib/ratelimit';
import { errorResponse, ApiError } from '@/lib/rbac';
import { RegisterSchema } from '@/lib/schemas';

export const runtime = 'nodejs'; // bcryptjs + Prisma need the Node runtime, not Edge

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
    if (!(await checkRateLimit(authLimiter, ip))) {
      return NextResponse.json({ error: 'Too many attempts, try again shortly' }, { status: 429 });
    }

    const { name, email, phone, password, country } = RegisterSchema.parse(await req.json());

    const passwordHash = await hashPassword(password);
    const user = await prisma.user
      .create({ data: { name, email, phone, passwordHash, country } })
      .catch((err: any) => {
        // Unlike login/password-reset (where hiding whether an email exists
        // matters for anti-enumeration), a signup form conventionally does
        // tell you the email's taken — that's normal, expected UX here.
        if (err?.code === 'P2002') throw new ApiError(409, 'An account with this email already exists');
        throw err;
      });

    return NextResponse.json({ id: user.id, name: user.name, email: user.email });
  } catch (err) {
    return errorResponse(err);
  }
}
