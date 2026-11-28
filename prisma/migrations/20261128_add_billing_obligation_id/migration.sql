-- Phase 1D.16: Add billingObligationId to Subscription for immutable entitlement identity
--
-- Adds `billingObligationId` column to Subscription to provide a persistent,
-- immutable canonical billing obligation identity that does not depend on the
-- mutable `endAt` field. This ensures webhook, cron, and reconciliation all
-- converge on the same obligation ID for the same billing period, even when
-- `endAt` changes after entitlement extension.
--
-- The obligation ID format is: obligation_<subscriptionId>_<periodStartEpoch>
-- where periodStartEpoch is the timestamp when the billing period begins
-- (i.e., the previous endAt before extension).
--
-- Backfill strategy:
--   Existing subscriptions have NULL billingObligationId. The column is
--   nullable to allow safe addition. The application layer computes and stores
--   the obligation ID on first entitlement application for each period.
--   No historical data is modified, deleted, or merged.

-- Step 1: Add billingObligationId column (nullable for safe addition)
ALTER TABLE "Subscription" ADD COLUMN "billingObligationId" TEXT;

-- Step 2: Add unique constraint
-- This will fail if duplicate billingObligationId values exist after any
-- backfill. No backfill is performed here; the column starts NULL for all
-- existing rows and is populated lazily by the application layer.
CREATE UNIQUE INDEX "Subscription_billingObligationId_key" ON "Subscription"("billingObligationId");
