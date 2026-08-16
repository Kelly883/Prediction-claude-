-- Add account lockout fields to User table
-- failedLoginAttempts tracks consecutive failed logins
-- lockedUntil is set when account is temporarily locked
ALTER TABLE "User" ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lockedUntil" TIMESTAMP;

-- Index for efficient lookups of locked accounts during login
CREATE INDEX "User_lockedUntil_idx" ON "User"("lockedUntil");
