import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin, errorResponse, ApiError } from '@/lib/rbac';
import { hashPassword } from '@/lib/password';
import { writeAudit } from '@/lib/audit';
import { requireSameOrigin, requireCsrf } from '@/lib/csrf';
import crypto from 'crypto';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    requireSameOrigin(req);
    requireCsrf(req);
    const superadmin = await requireSuperAdmin(req);
    const body = await req.json();
    const { name, email, phone, country, password, permissions } = body;

    if (!name || !email) {
      throw new ApiError(400, 'Name and email are required');
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ApiError(409, 'An account with this email already exists');
    }

    const defaultPassword = password || crypto.randomBytes(16).toString('hex');
    const passwordHash = await hashPassword(defaultPassword);

    const newAdmin = await prisma.user.create({
      data: {
        name,
        email,
        phone: phone || null,
        country: country || 'Nigeria',
        role: 'admin',
        permissions: Array.isArray(permissions) ? permissions : [],
        grantedBy: superadmin.sub,
        grantedAt: new Date(),
        passwordHash,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        country: true,
        role: true,
        createdAt: true,
        permissions: true,
        grantedBy: true,
        grantedAt: true,
      },
    });

    await writeAudit({
      actorId: superadmin.sub,
      action: 'admin.create',
      targetId: newAdmin.id,
      metadata: { email, role: 'admin', permissions: newAdmin.permissions },
    });

    return NextResponse.json(newAdmin, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
