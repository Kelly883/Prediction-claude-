import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePermission, requirePermissionWith2FA, errorResponse, ApiError } from '@/lib/rbac';
import { hashPassword } from '@/lib/password';
import { writeAudit } from '@/lib/audit';
import { parsePagination, withPaginationHeaders } from '@/lib/pagination';
import { PERMISSIONS } from '@/lib/permissions';
import crypto from 'crypto';

export const runtime = 'nodejs';

const SAFE_USER_FIELDS = {
  id: true,
  name: true,
  email: true,
  phone: true,
  country: true,
  role: true,
  createdAt: true,
  emailVerifiedAt: true,
  permissions: true,
  grantedBy: true,
  grantedAt: true,
} as const;

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, PERMISSIONS.pages.users);
    const searchParams = req.nextUrl.searchParams;
    const roleParam = searchParams.get('role');
    const queryParam = searchParams.get('q')?.trim().toLowerCase() || '';
    const { page, pageSize, offset } = parsePagination(req);

    const users = await prisma.user.findMany({
      where: { deletedAt: null },
      select: SAFE_USER_FIELDS,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: pageSize,
    });

    const totalUsers = await prisma.user.count({ where: { deletedAt: null } });
    const userIds = users.map((u) => u.id);

    const subscriptions = await prisma.subscription.findMany({
      where: { userId: { in: userIds } },
      include: {
        plan: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalRevenueResult = await prisma.transaction.aggregate({
      where: { status: 'success' },
      _sum: { amount: true },
    });
    const totalRevenue = Number(totalRevenueResult._sum.amount || 0);

    const userSubMap = new Map<string, { status: string; planName: string; endAt: Date }>();
    const now = new Date();

    for (const sub of subscriptions) {
      if (!userSubMap.has(sub.userId)) {
        const isActive = sub.status === 'active' && new Date(sub.endAt) > now;
        const subStatus = isActive ? 'Active' : 'Expired';
        userSubMap.set(sub.userId, {
          status: subStatus,
          planName: sub.plan?.name || 'Pro',
          endAt: sub.endAt,
        });
      }
    }

    const enrichedUsers = users.map((u) => {
      const sub = userSubMap.get(u.id);
      let status = 'Free';
      let planName = 'Free';
      if (sub) {
        status = sub.status;
        planName = sub.planName;
      }
      return { ...u, status, planName };
    });

    const activeSubscribers = enrichedUsers.filter((u) => u.status === 'Active').length;
    const stats = {
      totalUsers,
      activeSubscribers,
      totalRevenue,
      conversionRate: totalUsers > 0 ? Math.round((activeSubscribers / totalUsers) * 100) : 0,
    };

    let filteredUsers = enrichedUsers;
    if (roleParam && roleParam !== 'all') {
      filteredUsers = filteredUsers.filter((u) => u.role.toLowerCase() === roleParam.toLowerCase());
    }
    if (queryParam) {
      filteredUsers = filteredUsers.filter(
        (u) =>
          u.name.toLowerCase().includes(queryParam) ||
          u.email.toLowerCase().includes(queryParam) ||
          (u.phone && u.phone.toLowerCase().includes(queryParam)) ||
          u.country.toLowerCase().includes(queryParam)
      );
    }

    const res = NextResponse.json({ users: filteredUsers, stats, total: totalUsers });
    return withPaginationHeaders(res, page, pageSize, totalUsers);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requirePermission(req, PERMISSIONS.admin.createAdmins);
    const body = await req.json();
    const { name, email, phone, country, role, password, permissions } = body;

    if (!name || !email) {
      throw new ApiError(400, 'Name and email are required');
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ApiError(409, 'An account with this email already exists');
    }

    if (role === 'superadmin') {
      throw new ApiError(403, 'Cannot create superadmin accounts');
    }

    const defaultPassword = password || crypto.randomBytes(16).toString('hex');
    const passwordHash = await hashPassword(defaultPassword);

    const newUser = await prisma.user.create({
      data: {
        name,
        email,
        phone: phone || null,
        country: country || 'Nigeria',
        role: role === 'admin' ? 'admin' : 'user',
        permissions: role === 'admin' && Array.isArray(permissions) ? permissions : [],
        grantedBy: admin.sub,
        grantedAt: new Date(),
        passwordHash,
      },
      select: SAFE_USER_FIELDS,
    });

    await writeAudit({
      actorId: admin.sub,
      action: 'user.create',
      targetId: newUser.id,
      metadata: { email, role: newUser.role, permissions: newUser.permissions },
    });
    return NextResponse.json(newUser, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const admin = await requirePermissionWith2FA(req, PERMISSIONS.pages.users);
    const { id } = await req.json();

    if (id === admin.sub) {
      throw new ApiError(400, 'You cannot delete your own account');
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new ApiError(404, 'User not found');

    await prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await writeAudit({ actorId: admin.sub, action: 'user.soft_delete', targetId: id, metadata: { email: user.email } });
    return NextResponse.json({ ok: true, message: 'User soft-deleted' });
  } catch (err) {
    return errorResponse(err);
  }
}
