-- Add refreshTokenVersion to User model for refresh token rotation
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "refreshTokenVersion" INTEGER NOT NULL DEFAULT 0;

-- Index for faster lookups during token rotation
CREATE INDEX IF NOT EXISTS "User_refreshTokenVersion_idx" ON "User"("refreshTokenVersion");
