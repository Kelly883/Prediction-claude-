-- CreateEnum
CREATE TYPE "OutcomeStatus" AS ENUM ('pending', 'won', 'lost');

-- AlterTable
ALTER TABLE "PredictionPost" ADD COLUMN "outcome" "OutcomeStatus" NOT NULL DEFAULT 'pending';

-- CreateIndex
CREATE INDEX "PredictionPost_outcome_status_idx" ON "PredictionPost"("outcome", "status");
