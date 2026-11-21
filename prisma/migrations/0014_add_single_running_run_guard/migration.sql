-- Cron concurrency guard.
--
-- The Redis NX lock is the primary de-duplication mechanism, but it is a
-- best-effort distributed lock. This partial unique index is the authoritative
-- database-level guarantee that at most one analysis run is `running` per day,
-- so overlapping cron invocations (or a Redis outage) cannot start two
-- concurrent runs. Application code catches the P2002 violation and reports the
-- in-flight run instead.
--
-- NOTE: Prisma schema cannot express partial indexes. This index intentionally
-- lives only in migration SQL; `prisma migrate deploy` applies it and
-- `prisma migrate status` reports no pending migrations. Do not add a shadowing
-- field to schema.prisma.
--
-- Preflight (run manually first if a stuck `running` run exists for a past date):
--   SELECT "runDate", COUNT(*) FROM "AnalysisRun"
--   WHERE "status" = 'running' GROUP BY "runDate" HAVING COUNT(*) > 1;
CREATE UNIQUE INDEX "AnalysisRun_running_runDate_key"
  ON "AnalysisRun" ("runDate")
  WHERE "status" = 'running';
