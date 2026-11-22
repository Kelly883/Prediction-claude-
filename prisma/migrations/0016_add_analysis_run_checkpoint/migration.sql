-- Stage C: durable run checkpoints for resumable daily-analysis runs.
-- `checkpoint` holds batch progress (phase, processed fixture ids, totals) so a
-- timed-out/crashed run can resume from the last completed batch instead of
-- restarting enrichment from scratch. `attempts` bounds resume retries.

ALTER TABLE "AnalysisRun" ADD COLUMN "checkpoint" JSONB;
ALTER TABLE "AnalysisRun" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;