-- AlterEnum
ALTER TYPE "TransactionStatus" ADD VALUE IF NOT EXISTS 'processing';
ALTER TYPE "TransactionStatus" ADD VALUE IF NOT EXISTS 'cancelled';

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Transaction" ADD COLUMN "completedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Transaction_userId_createdAt_idx" ON "Transaction"("userId", "createdAt");
