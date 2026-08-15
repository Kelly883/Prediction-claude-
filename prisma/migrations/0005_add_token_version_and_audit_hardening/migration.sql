-- AlterTable User: Add tokenVersion for session and refresh token invalidation
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable AuditLog: Make actorId nullable for unauthenticated / system security events
ALTER TABLE "AuditLog" ALTER COLUMN "actorId" DROP NOT NULL;
