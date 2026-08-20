-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'superadmin';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "grantedAt" TIMESTAMP,
ADD COLUMN     "grantedBy" TEXT,
ADD COLUMN     "lastLoginAt" TIMESTAMP;

-- CreateIndex
CREATE INDEX "User_permissions_idx" ON "User" USING GIN ("permissions");
