-- CreateEnum
CREATE TYPE "RenewalStatus" AS ENUM ('idle', 'processing', 'failed');

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "renewalStatus" "RenewalStatus" NOT NULL DEFAULT 'idle';
ALTER TABLE "Subscription" ADD COLUMN "renewalLockedAt" TIMESTAMP(3);
ALTER TABLE "Subscription" ADD COLUMN "renewalReference" TEXT;

-- CreateIndex
CREATE INDEX "Subscription_status_autoRenew_endAt_renewalStatus_idx" ON "Subscription"("status", "autoRenew", "endAt", "renewalStatus");
