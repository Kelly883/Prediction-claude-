import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/password';
import { checkRateLimit, authLimiter } from '@/lib/ratelimit';
import { errorResponse, ApiError } from '@/lib/rbac';
import { RegisterSchema } from '@/lib/schemas';
import { issueAccessToken, issueRefreshToken, cookieOptions } from '@/lib/auth';
import { touchSession } from '@/lib/sessions';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const adminCount = await prisma.user.count({ where: { role: 'admin' } });
    return NextResponse.json({
      isSetupAvailable: adminCount === 0,
      adminCount,
    });
  } catch (err) {
    return NextResponse.json({ isSetupAvailable: false, error: 'Database unavailable' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
    if (!(await checkRateLimit(authLimiter, ip))) {
      return NextResponse.json({ error: 'Too many attempts, try again shortly' }, { status: 429 });
    }

    // Check if an admin account already exists
    const existingAdminCount = await prisma.user.count({ where: { role: 'admin' } });
    if (existingAdminCount > 0) {
      throw new ApiError(403, 'Administrator account has already been registered. Initial setup is deactivated.');
    }

    const { name, email, phone, password, country } = RegisterSchema.parse(await req.json());

    const passwordHash = await hashPassword(password);

    // Create the admin user
    const admin = await prisma.user
      .create({
        data: {
          name,
          email,
          phone,
          passwordHash,
          country,
          role: 'admin',
        },
      })
      .catch((err: any) => {
        if (err?.code === 'P2002') {
          throw new ApiError(409, 'An account with this email already exists');
        }
        throw err;
      });

    // Auto-login: issue access and refresh tokens
    const accessToken = await issueAccessToken({ sub: admin.id, role: 'admin' });
    const refreshToken = await issueRefreshToken(admin.id);

    await touchSession(admin.id, req);
    await writeAudit({
      actorId: admin.id,
      action: 'admin.initial_setup',
      targetId: admin.id,
      metadata: { email: admin.email, country: admin.country },
    });

    const res = NextResponse.json({
      success: true,
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
    });

    res.cookies.set('access_token', accessToken, cookieOptions(15 * 60));
    res.cookies.set('refresh_token', refreshToken, cookieOptions(7 * 24 * 60 * 60));

    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
