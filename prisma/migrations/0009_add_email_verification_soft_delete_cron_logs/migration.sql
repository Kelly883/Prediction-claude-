-- Add email verification and soft-delete fields to User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP;

-- Create email verification token table
CREATE TABLE IF NOT EXISTS "EmailVerificationToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP NOT NULL,
  "usedAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

-- Create cron execution log table
CREATE TABLE IF NOT EXISTS "CronExecutionLog" (
  "id" TEXT NOT NULL,
  "jobName" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "startedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP,
  "metadata" JSONB,
  "error" TEXT,
  CONSTRAINT "CronExecutionLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CronExecutionLog_jobName_idx" ON "CronExecutionLog"("jobName");
CREATE INDEX IF NOT EXISTS "CronExecutionLog_startedAt_idx" ON "CronExecutionLog"("startedAt");
