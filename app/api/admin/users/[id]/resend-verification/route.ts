import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, errorResponse, ApiError } from '@/lib/rbac';
import { requireSameOrigin, requireCsrf } from '@/lib/csrf';
import { sendAdminVerificationEmail } from '@/lib/email';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';
const TOKEN_TTL_HOURS = 24;

// Admin-triggered counterpart to the public /api/auth/resend-verification —
// same underlying action, but for support cases: an admin looking at a
// specific account (e.g. someone emailed support saying they never got
// their link) rather than the user self-serving via their own email. No
// enumeration concern here since the admin is already looking at a real
// user record by ID, not guessing emails.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(req);
    requireCsrf(req);
    const admin = await requireAdmin(req);
    const { id } = await params;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user || user.deletedAt) throw new ApiError(404, 'User not found');
    if (user.emailVerifiedAt) throw new ApiError(400, 'This user is already verified');

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await prisma.emailVerificationToken.create({
      data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000) },
    });

    await writeAudit({ actorId: admin.sub, action: 'admin.email_verification_resent', targetId: user.id });

    const verificationUrl = `${process.env.APP_URL}/verify-email?token=${rawToken}`;

    try {
      await sendAdminVerificationEmail(user.email, verificationUrl);
    } catch (emailErr) {
      console.error('Failed to send verification email (admin-triggered)', emailErr);
      throw new ApiError(502, "Couldn't send the email — check RESEND_API_KEY/RESEND_FROM_EMAIL are configured correctly.");
    }

    return NextResponse.json({ message: `Verification email sent to ${user.email}.` });
  } catch (err) {
    return errorResponse(err);
  }
}
