-- Hand-authored initial migration, written directly from schema.prisma.
-- Generated (not run) because binaries.prisma.sh — required for the real
-- `prisma migrate dev` — isn't reachable from the sandbox this was built in.
-- Verify with `npx prisma migrate diff --from-migrations ./prisma/migrations
-- --to-schema-datamodel ./prisma/schema.prisma --script` in a normal
-- environment before trusting this blindly against production; it should
-- produce an empty diff if this file is accurate.

CREATE TYPE "Role" AS ENUM ('admin', 'user');
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'cancelled', 'expired');
CREATE TYPE "PaymentProvider" AS ENUM ('paystack', 'flutterwave');
CREATE TYPE "Currency" AS ENUM ('NGN', 'USD');
CREATE TYPE "TransactionStatus" AS ENUM ('pending', 'success', 'failed');
CREATE TYPE "AccessScope" AS ENUM ('all', 'category');
CREATE TYPE "PostVisibility" AS ENUM ('plan_specific', 'subscribers', 'free_window');
CREATE TYPE "PostStatus" AS ENUM ('draft', 'scheduled', 'published', 'archived');
CREATE TYPE "FreeAccessRuleType" AS ENUM ('global_trial', 'promo_window');

CREATE TABLE "User" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'user',
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorSecret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_role_idx" ON "User"("role");

CREATE TABLE "Plan" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "name" TEXT NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "priceNGN" DECIMAL(12,2) NOT NULL,
    "priceUSDOverride" DECIMAL(12,2),
    "fxMarkupPercent" DECIMAL(5,2),
    "accessScope" "AccessScope" NOT NULL DEFAULT 'all',
    "categoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Plan_isActive_idx" ON "Plan"("isActive");

CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "renewalProvider" "PaymentProvider",
    "renewalAuthCode" TEXT,
    "renewalAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastRenewalError" TEXT,
    "renewalReminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Subscription_userId_status_endAt_idx" ON "Subscription"("userId", "status", "endAt");

CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "userId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "planId" TEXT,
    "provider" "PaymentProvider" NOT NULL,
    "providerReference" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "fxRateUsed" DECIMAL(12,6),
    "status" "TransactionStatus" NOT NULL DEFAULT 'pending',
    "idempotencyKey" TEXT NOT NULL,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaction_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Transaction_providerReference_key" ON "Transaction"("providerReference");
CREATE UNIQUE INDEX "Transaction_idempotencyKey_key" ON "Transaction"("idempotencyKey");
CREATE INDEX "Transaction_status_idx" ON "Transaction"("status");

CREATE TABLE "PredictionPost" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "title" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "categoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bookingCode" TEXT NOT NULL,
    "bodyNotes" TEXT,
    "visibility" "PostVisibility" NOT NULL DEFAULT 'subscribers',
    "freeUntil" TIMESTAMP(3),
    "planIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "PostStatus" NOT NULL DEFAULT 'draft',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PredictionPost_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PredictionPost_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "PredictionPost_status_scheduledAt_idx" ON "PredictionPost"("status", "scheduledAt");

CREATE TABLE "PredictionItem" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "postId" TEXT NOT NULL,
    "match" TEXT NOT NULL,
    "prediction" TEXT NOT NULL,
    "matchDateTime" TIMESTAMP(3),
    CONSTRAINT "PredictionItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PredictionItem_postId_fkey" FOREIGN KEY ("postId") REFERENCES "PredictionPost"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PredictionItem_postId_idx" ON "PredictionItem"("postId");

CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "postId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "watermarkEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MediaAsset_postId_fkey" FOREIGN KEY ("postId") REFERENCES "PredictionPost"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MediaAsset_postId_idx" ON "MediaAsset"("postId");

CREATE TABLE "FreeAccessRule" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "type" "FreeAccessRuleType" NOT NULL,
    "trialDays" INTEGER,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FreeAccessRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FreeAccessRule_isActive_type_idx" ON "FreeAccessRule"("isActive", "type");

CREATE TABLE "ComplimentaryAccess" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "userId" TEXT NOT NULL,
    "postId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ComplimentaryAccess_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ComplimentaryAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ComplimentaryAccess_postId_fkey" FOREIGN KEY ("postId") REFERENCES "PredictionPost"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ComplimentaryAccess_userId_idx" ON "ComplimentaryAccess"("userId");

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

CREATE TABLE "CmsSection" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "page" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CmsSection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CmsSection_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CmsSection_page_key_key" ON "CmsSection"("page", "key");

CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "userId" TEXT NOT NULL,
    "deviceFingerprint" TEXT NOT NULL,
    "ip" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "UserSession_userId_lastSeenAt_idx" ON "UserSession"("userId", "lastSeenAt");

CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
