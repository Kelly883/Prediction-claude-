ALTER TABLE "Plan" ADD COLUMN "createdById" TEXT;
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Plan_createdById_idx" ON "Plan"("createdById");
