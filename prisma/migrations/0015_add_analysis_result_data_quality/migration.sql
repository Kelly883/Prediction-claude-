-- Phase 1 data-completeness remediation (Stages 3, 6, 8).
--
-- Non-destructive, additive migration:
--   * `bestOdds` becomes NULLABLE so a pick without a captured bookmaker price
--     is stored as NULL rather than a fabricated default (Stage 3).
--   * New nullable provenance / data-quality columns record what data the engine
--     actually used and why markets were excluded, so superadmins can see
--     degraded/fallback enrichment (Stage 6/8).
--
-- Existing rows are preserved. No columns are dropped or renamed.

ALTER TABLE "AnalysisResult" ALTER COLUMN "bestOdds" DROP NOT NULL;

ALTER TABLE "AnalysisResult" ADD COLUMN "enrichmentQuality" TEXT;
ALTER TABLE "AnalysisResult" ADD COLUMN "providerSource" TEXT;
ALTER TABLE "AnalysisResult" ADD COLUMN "missingDataFields" JSONB;
ALTER TABLE "AnalysisResult" ADD COLUMN "marketEligibility" JSONB;
ALTER TABLE "AnalysisResult" ADD COLUMN "marketExclusionReason" TEXT;
ALTER TABLE "AnalysisResult" ADD COLUMN "fixtureStatus" TEXT;
ALTER TABLE "AnalysisResult" ADD COLUMN "seasonId" TEXT;
ALTER TABLE "AnalysisResult" ADD COLUMN "oddsSource" TEXT;
ALTER TABLE "AnalysisResult" ADD COLUMN "oddsCapturedAt" TIMESTAMP(3);

-- Administrator review filters by data quality and season; both are low-cost,
-- non-unique indexes over nullable columns.
CREATE INDEX "AnalysisResult_enrichmentQuality_idx" ON "AnalysisResult" ("enrichmentQuality");
CREATE INDEX "AnalysisResult_seasonId_idx" ON "AnalysisResult" ("seasonId");
