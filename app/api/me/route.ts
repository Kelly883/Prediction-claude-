import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, errorResponse, ApiError } from '@/lib/rbac';
import { requireCsrf, requireSameOrigin } from '@/lib/csrf';
import { PERMISSIONS, ALL_PERMISSIONS } from '@/lib/permissions';
import { UpdateProfileSchema } from '@/lib/schemas';
import { sendVerificationEmail, getAppUrl } from '@/lib/emails';
import { verifyTotpCode } from '@/lib/twofactor';
import crypto from 'crypto';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const record = await prisma.user.findUniqueOrThrow({ where: { id: user.sub } });
    if (record.deletedAt) throw new ApiError(403, 'Account has been deactivated');
    const permissions = record.role === 'superadmin'
      ? ALL_PERMISSIONS
      : record.permissions;
    return NextResponse.json({ id: record.id, name: record.name, email: record.email, phone: record.phone, country: record.country, role: record.role, emailVerified: !!record.emailVerifiedAt, permissions });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    requireSameOrigin(req);
    requireCsrf(req);
    const user = await requireUser(req);
    const dto = UpdateProfileSchema.parse(await req.json());

    if (dto.email) {
      const normalizedNew = dto.email.trim().toLowerCase();
      const existing = await prisma.user.findUnique({ where: { email: normalizedNew } });
      if (existing && existing.id !== user.sub) {
        throw new ApiError(409, 'Email is already in use');
      }

      const record = await prisma.user.findUniqueOrThrow({ where: { id: user.sub } });

      if (record.emailVerifiedAt && normalizedNew !== record.email) {
        const hasChangeEmailPermission = user.role === 'superadmin' || record.permissions.includes(PERMISSIONS.admin.changeEmail);
        if (!hasChangeEmailPermission) {
          throw new ApiError(403, 'You do not have permission to change your email address. Contact a superadmin.');
        }

        if (user.role === 'superadmin' && user.sub === record.id) {
          if (!dto.twoFactorCode) {
            throw new ApiError(400, 'Two-factor authentication code is required for superadmin email changes');
          }
          const valid = verifyTotpCode(record.twoFactorSecret ?? '', dto.twoFactorCode);
          if (!valid) {
            const codeHash = crypto.createHash('sha256').update(dto.twoFactorCode.toUpperCase()).digest('hex');
            const recoveryRecord = await prisma.twoFactorRecoveryCode.findFirst({
              where: { userId: user.sub, codeHash, usedAt: null },
            });
            if (!recoveryRecord) {
              throw new ApiError(400, 'Invalid two-factor authentication code');
            }
            await prisma.twoFactorRecoveryCode.update({
              where: { id: recoveryRecord.id },
              data: { usedAt: new Date() },
            });
          }
        }
      }

      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const updated = await prisma.$transaction(async (db) => {
        await db.emailVerificationToken.updateMany({
          where: { userId: user.sub, usedAt: null, expiresAt: { gt: new Date() } },
          data: { usedAt: new Date() },
        });

        const userUpdated = await db.user.update({
          where: { id: user.sub },
          data: {
            name: dto.name ?? undefined,
            email: normalizedNew,
            phone: dto.phone,
            emailVerifiedAt: null,
            emailVerifications: { create: { tokenHash, expiresAt } },
          },
        });

        await db.emailVerificationToken.findFirst({
          where: { userId: user.sub, tokenHash, usedAt: null },
        });

        return userUpdated;
      });

      const verificationUrl = `${getAppUrl()}/verify-email?token=${rawToken}`;
      let verificationEmailSent = false;
      try {
        await sendVerificationEmail(updated.email, verificationUrl);
        verificationEmailSent = true;
      } catch (emailErr) {
        console.error('Failed to send verification email after email change', emailErr);
      }

      return NextResponse.json({ id: updated.id, name: updated.name, email: updated.email, phone: updated.phone, country: updated.country, role: updated.role, emailVerified: false, verificationEmailSent });
    }

    const record = await prisma.user.update({ where: { id: user.sub }, data: dto });
    const permissions = record.role === 'superadmin'
      ? ALL_PERMISSIONS
      : record.permissions;
    return NextResponse.json({ id: record.id, name: record.name, email: record.email, phone: record.phone, country: record.country, role: record.role, emailVerified: !!record.emailVerifiedAt, permissions });
  } catch (err) {
    return errorResponse(err);
  }
}
