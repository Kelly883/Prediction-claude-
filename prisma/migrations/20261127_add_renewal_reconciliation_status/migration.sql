-- Phase 1D.5 (F-02): add durable `reconciliation_required` renewal state.
-- PREPARE ONLY — do NOT apply to a live database in this phase.
-- Apply via the normal reviewed migration process during deployment.
ALTER TYPE "RenewalStatus" ADD VALUE IF NOT EXISTS 'reconciliation_required';