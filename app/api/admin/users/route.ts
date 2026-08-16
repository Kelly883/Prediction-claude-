import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, errorResponse, ApiError } from '@/lib/rbac';
import { hashPassword } from '@/lib/password';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

// SECURITY: explicit `select` is load-bearing here, not stylistic — without
// it, Prisma returns the full row including passwordHash and
// twoFactorSecret (the raw TOTP seed; leaking it defeats 2FA entirely for
// that account). Never change this to a bare findMany() with no select.
const SAFE_USER_FIELDS = {
  id: true,
  name: true,
  email: true,
  phone: true,
  country: true,
  role: true,
  createdAt: true,
} as const;

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const searchParams = req.nextUrl.searchParams;
    const statusParam = searchParams.get('status'); // 'paid', 'unpaid', 'active', 'expired', 'free', 'trial', or null
    const roleParam = searchParams.get('role'); // 'admin', 'user', or null
    const queryParam = searchParams.get('q')?.trim().toLowerCase() || '';

    // Fetch all non-deleted users with safe fields
    const users = await prisma.user.findMany({
      where: { deletedAt: null },
      select: SAFE_USER_FIELDS,
      orderBy: { createdAt: 'desc' },
    });

    // Fetch active/all subscriptions to compute statuses and plan names
    const subscriptions = await prisma.subscription.findMany({
      include: {
        plan: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Fetch transactions for total volume/conversion stats
    const successfulTxList = await prisma.transaction.findMany({
      where: { status: 'success' },
    });
    const totalRevenue = successfulTxList.reduce((acc: number, tx: any) => acc + (Number(tx.amount) || 0), 0);

    // Map user ID to active or latest subscription
    const userSubMap = new Map<string, { status: string; planName: string; endAt: Date }>();
    const now = new Date();

    for (const sub of subscriptions) {
      if (!userSubMap.has(sub.userId)) {
        const isActive = sub.status === 'active' && new Date(sub.endAt) > now;
        const subStatus = isActive ? 'Active' : sub.status === 'expired' ? 'Expired' : 'Expired';
        userSubMap.set(sub.userId, {
          status: subStatus,
          planName: sub.plan?.name || 'Pro',
          endAt: sub.endAt,
        });
      }
    }

    // Process user list with subscription details
    const enrichedUsers = users.map((u) => {
      const sub = userSubMap.get(u.id);
      let status = 'Free';
      let planName = 'Free';

      if (sub) {
        status = sub.status;
        planName = sub.planName;
      }

      return {
        ...u,
        status, // 'Active' | 'Expired' | 'Free' | 'Trial'
        planName,
      };
    });

    // Calculate metrics
    const totalUsers = users.length;
    const activeSubscribers = enrichedUsers.filter((u) => u.status === 'Active').length;
    const freeTrialUsers = enrichedUsers.filter((u) => u.status === 'Free' || u.status === 'Trial').length;
    const stats = {
      totalUsers,
      activeSubscribers,
      freeTrialUsers,
      totalRevenue,
      conversionRate: totalUsers > 0 ? Math.round((activeSubscribers / totalUsers) * 100) : 0,
    };

    // Filter users according to search & filter criteria
    let filteredUsers = enrichedUsers;

    if (roleParam && roleParam !== 'all') {
      filteredUsers = filteredUsers.filter((u) => u.role.toLowerCase() === roleParam.toLowerCase());
    }

    if (statusParam && statusParam !== 'all') {
      if (statusParam === 'paid') {
        filteredUsers = filteredUsers.filter((u) => u.status === 'Active');
      } else if (statusParam === 'unpaid') {
        filteredUsers = filteredUsers.filter((u) => u.status !== 'Active');
      } else {
        filteredUsers = filteredUsers.filter((u) => u.status.toLowerCase() === statusParam.toLowerCase());
      }
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

    return NextResponse.json({
      users: filteredUsers,
      stats,
      total: totalUsers,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const body = await req.json();
    const { name, email, phone, country, role, password } = body;

    if (!name || !email) {
      throw new ApiError(400, 'Name and email are required');
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ApiError(409, 'An account with this email already exists');
    }

    if (!password || password.trim().length === 0) {
      throw new ApiError(400, 'Password is required for new users');
    }

    const passwordHash = await hashPassword(password);

    const newUser = await prisma.user.create({
      data: {
        name,
        email,
        phone: phone || null,
        country: country || 'Nigeria',
        role: role === 'admin' ? 'admin' : 'user',
        passwordHash,
      },
      select: SAFE_USER_FIELDS,
    });

    await writeAudit({ actorId: admin.sub, action: 'user.create', targetId: newUser.id, metadata: { email, role: newUser.role } });
    return NextResponse.json(newUser, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
