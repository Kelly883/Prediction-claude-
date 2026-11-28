-- Phase 1D.13: Database-enforced entitlement idempotency and atomic subscription extension
--
-- Adds:
--   1. `providerTransactionId` column to Transaction (missing from prior migrations)
--   2. `obligationId` column to Transaction (canonical billing obligation identity)
--   3. `previousEndAt` and `resultingEndAt` columns for entitlement audit
--   4. Unique index on `obligationId` — at most one entitlement application per obligation
--   5. Unique index on `(provider, providerTransactionId)` — one record per provider transaction
--   6. Index on `obligationId` for fast lookups
--
-- DUPLICATE DETECTION (run before applying):
--   SELECT obligationId, count(*) FROM "Transaction" GROUP BY obligationId HAVING count(*) > 1;
--   SELECT provider, providerTransactionId, count(*) FROM "Transaction"
--     WHERE providerTransactionId IS NOT NULL
--     GROUP BY provider, providerTransactionId HAVING count(*) > 1;
-- If either query returns rows, resolve duplicates before applying this migration.
-- Do NOT delete or merge payment history.

-- Step 1: Add new columns (nullable to allow safe addition to existing rows)
ALTER TABLE "Transaction" ADD COLUMN "providerTransactionId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "obligationId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "previousEndAt" TIMESTAMP(3);
ALTER TABLE "Transaction" ADD COLUMN "resultingEndAt" TIMESTAMP(3);

-- Step 2: Backfill obligationId from providerReference.
-- Strip the _attN attempt suffix from cron renewal references so that
-- retries of the same obligation resolve to a single canonical identity.
-- Example: renew_sub-1_1234567890_att1 -> renew_sub-1_1234567890
-- Example: pp_abc-123-def -> pp_abc-123-def (unchanged)
UPDATE "Transaction"
SET "obligationId" = regexp_replace("providerReference", '_att\d+$', '')
WHERE "obligationId" IS NULL;

-- Step 3: Safety backfill for any rows still without obligationId
UPDATE "Transaction"
SET "obligationId" = "providerReference"
WHERE "obligationId" IS NULL;

-- Step 4: Add unique constraints
-- These will fail if duplicate obligationId or (provider, providerTransactionId)
-- values exist after backfill. Resolve duplicates first (see queries above).
CREATE UNIQUE INDEX "Transaction_obligationId_key" ON "Transaction"("obligationId");
CREATE UNIQUE INDEX "Transaction_provider_providerTransactionId_key"
  ON "Transaction"("provider", "providerTransactionId");

-- Step 5: Add supporting index
CREATE INDEX "Transaction_obligationId_idx" ON "Transaction"("obligationId");
