# PredictPro — Phase 1 Data Completeness Remediation

**Date:** 2026-11-22
**Scope:** Remediate the seven blockers from the *Phase 1 Data Completeness & Prediction Engine Audit* (2026-11-22).
**Nature:** Implementation + verification (code, tests, evidence). No deployment, no commits, no production execution.

> **Evidence labels used throughout**
> - **VERIFIED** — demonstrated by code, test, or actual provider evidence.
> - **CALCULATED** — derived mathematically from verified inputs.
> - **ESTIMATED** — based on assumptions.
> - **NOT VERIFIED** — evidence is unavailable.
>
> No item is marked VERIFIED merely because code was written. Where verification requires a live provider call that was **not authorized/performed**, the item is labelled **NOT VERIFIED**.

---

## 1. Original audit findings

The audit identified seven data-completeness blockers that could cause the Phase 1 pipeline to emit untrustworthy picks on its first production run:

| # | Blocker | Audit concern |
|---|---|---|
| B1 | Provider data contract (team statistics) | `normalizeTeamStats` appeared to expect `statistics: [{ type, value }]`, but API-Football v3 `/teams/statistics` returns a **nested** object (`fixtures`, `goals`, `biggest`, `clean_sheet`, `failed_to_score`, `penalty`, `lineups`, `cards`). If wrong, every team stat maps to `undefined`. |
| B2 | Current-season access for 20 leagues | Season derivation assumed the fixture's UTC calendar year for **all** competitions; split-season (European/UEFA) vs calendar-year (Americas/Japan) were not distinguished. |
| B3 | Fabricated odds | A default decimal price of **1.91** was stored as `bestOdds` when no bookmaker odds existed, presenting a made-up price as a market price. |
| B4 | Missing market eligibility gates | The engine scored a market whenever its function returned a number, even with no supporting evidence. |
| B5 | Invalid fixture statuses | Postponed / cancelled / abandoned / suspended / finished fixtures could enter the prediction pipeline. |
| B6 | Fallback-degraded data unlabelled | Football-Data.org fallback enrichment was treated as equivalent to primary API-Football enrichment. |
| B7 | Evidence / confidence inflation | Missing or synthetic values (placeholder injuries `0`, stub H2H, one-sided missing xG) could inflate the model score near the 75 threshold. |

---

## 2. Each blocker and its remediation

### B1 — Provider data contract (Stage 1)

**1.1 `/teams/statistics` + `normalizeTeamStats`**

- **Finding:** The mismatch is **confirmed at the schema level**, not by a live capture. API-Football's documented v3 contract returns a nested object under `response`; the `{ type, value }` array shape belongs to the sibling endpoint `/fixtures/statistics`. The previous normalizer read the array shape and therefore mapped every field to `undefined`.
- **Remediation:** [`normalizeTeamStats`](file:///workspace/lib/api/football-api.ts#L250-L267) now reads the nested structure — `goals.for.total.total`, `goals.against.total.total`, `form`, and card buckets summed from `cards.yellow`/`cards.red` (each bucket's `total`) via [`sumCardBuckets`](file:///workspace/lib/api/football-api.ts#L219-L235). Fields the endpoint does **not** provide (xG, corners, shots) stay `undefined` (missing), never coerced to `0`.
- **Evidence fixture:** [`tests/fixtures/api-football/team-statistics.sample.json`](file:///workspace/tests/fixtures/api-football/team-statistics.sample.json) — a **sanitized sample mirroring the documented v3 schema** (metadata stripped). This is **not** a live capture (see §5 and §11).
- **Regression tests:** [`tests/analysis-provider-schema.test.ts`](file:///workspace/tests/analysis-provider-schema.test.ts) asserts real values map (`goalsFor=19`, `goalsAgainst=10`, `form` parsed, `cardsFor` summed), that the legacy `[{type,value}]` array shape yields no data, and that missing / null / malformed payloads return `undefined` rather than zeros.

**Label:** schema shape **CALCULATED** (from documented contract); live-call confirmation **NOT VERIFIED**.

**1.2 `/fixtures` + `normalizeFixture`**

- **Finding:** The adapter already required identity/teams/competition/kickoff, but the Football-Data fallback normalizer had regressed to hard-require `entry.competition.name`, while the real v4 `/competitions/{code}/matches` envelope carries `competition` only at the **top level**.
- **Remediation:** [`normalizeFixture`](file:///workspace/lib/api/football-api.ts#L125-L165) (API-Football) rejects any fixture missing fixture id, team names, team ids, league name, or a parseable kickoff, and derives a `seasonId` (provider season if present, else competition-aware derivation). Football-Data [`normalizeFixture`](file:///workspace/lib/api/football-data.ts) now takes an optional `competitionName` from the envelope and falls back to the mapped competition code.
- **Evidence fixture:** [`tests/fixtures/api-football/fixtures.sample.json`](file:///workspace/tests/fixtures/api-football/fixtures.sample.json), [`tests/fixtures/football-data/fixtures.sample.json`](file:///workspace/tests/fixtures/football-data/fixtures.sample.json) (valid + invalid statuses + malformed entries to reject).
- **Tests:** the provider-schema suite maps identity, teams, league, kickoff, status and season, and asserts the malformed entries are rejected.

### B2 — Competition-aware season handling (Stage 2)

- **Remediation:** New module [`lib/api/season.ts`](file:///workspace/lib/api/season.ts):
  - `seasonStrategy(leagueCode)` → `'split'` (European/UEFA) or `'calendar'` (MLS, J1, BRA, ARG, LIB).
  - `deriveSeason(leagueCode, kickoff)` → split leagues return the season **start** year (kickoff month ≥ July → year, else year−1); calendar leagues return the UTC year. `deriveSeasonId` returns the provider string.
- `fetchApiFootballEnrichment` and fixture normalization now use the competition-aware season instead of raw UTC year.
- New readiness module [`lib/analysis/ingestion/readiness.ts`](file:///workspace/lib/analysis/ingestion/readiness.ts): `assessLeagueReadiness` / `assessAllLeagueReadiness` / `summarizeReadiness`. It reports, per league: mapped id, derived season, strategy, `addressable`, `primarySource`, `entitlement`, `withinFreeTierSeason`, `eligible`, and a human `reason`. Entitlement is **always `NOT_VERIFIED`** without a live probe — it is never assumed.
- **Isolation:** a single failing league never disables others; each reports its own reason.
- **Tests:** [`tests/analysis-season.test.ts`](file:///workspace/tests/analysis-season.test.ts) (boundaries: Aug 2026→2026, Feb 2026→2025, Jan 2027→2026; all 20 leagues assessed; mixed summaries).

### B3 — Remove fabricated odds (Stage 3)

- **Remediation:** The fabricated default price is gone. [`oddsOrNull`](file:///workspace/lib/analysis/markets/shared.ts#L40-L43) returns a real provider decimal `> 1` or **`null`** — there is deliberately no default. Every market module now emits `odds: number | null` plus `oddsAvailable: boolean`. Persistence validates via Zod `odds: z.number().finite().positive().nullable()`. [`PersistableAnalysisResult.bestOdds`](file:///workspace/lib/analysis/persistence.ts) is `number | null` and provenance is preserved (`oddsSource`, `oddsCapturedAt`).
- The publish path [`app/api/superadmin/analysis/results/[id]/publish/route.ts`](file:///workspace/app/api/superadmin/analysis/results/[id]/publish/route.ts) returns **409** when a price-required market (`ASIAN_HANDICAP`) has `bestOdds === null`.
- **Tests:** [`tests/analysis-utils.test.ts`](file:///workspace/tests/analysis-utils.test.ts) (`oddsOrNull(undefined/1/NaN) === null`, `oddsOrNull(2.5) === 2.5`), [`tests/analysis-persistence.test.ts`](file:///workspace/tests/analysis-persistence.test.ts) (`bestOdds`/`oddsSource` persisted as `null`, never a fabricated price). Coverage includes missing / valid / malformed / zero odds.

### B4 — Backend market eligibility gates (Stage 4)

- **Remediation:** New layer [`lib/analysis/markets/eligibility.ts`](file:///workspace/lib/analysis/markets/eligibility.ts). [`scoreFixture`](file:///workspace/lib/analysis/engine.ts#L25-L64) runs `evaluateAllEligibility(MARKET_ORDER, …)` **first**; only `allowedToProceed` markets are scored, ranked and persisted. Each decision returns the full structured result (market, `eligible`, `allowedToProceed`, `reason`, `missingFields`, `dataSources`, `dataQuality`, `oddsAvailable`).
- **Policy** (`DEFAULT_ELIGIBILITY_POLICY`): `disabledMarkets = ['TOTAL_CARDS','FIRST_HALF_RESULT','PLAYER_SCORER']`, `restrictedMarkets = ['TOTAL_CORNERS']`, `enforceStrictOnFallback = true`. Configurable — markets are gated, not deleted, so they can be re-enabled when data is verified.
- Asian Handicap self-gates on a captured bookmaker line; `marketRequiresOdds` gates publishing.
- **Tests:** [`tests/analysis-eligibility.test.ts`](file:///workspace/tests/analysis-eligibility.test.ts) (15 tests: all 10 markets, disabled policy, per-market requirements, fallback strictness, engine gate enforcement, persistence guard).

### B5 — Valid fixture statuses only (Stage 5)

- **Remediation:** New module [`lib/analysis/ingestion/status.ts`](file:///workspace/lib/analysis/ingestion/status.ts) maps API-Football short codes and Football-Data values onto one internal `FixtureStatus`, with `isPredictableStatus` (only `scheduled`) and `exclusionReason`. Unknown/malformed → `unknown` (not eligible). [`partitionByStatus`](file:///workspace/lib/analysis/ingestion/fixtures.ts) keeps only predictable fixtures and records exclusion reasons.
- **Tests:** [`tests/analysis-fixture-status.test.ts`](file:///workspace/tests/analysis-fixture-status.test.ts) (postponed, cancelled, abandoned, suspended, finished, in-play, awarded, unknown/malformed).

### B6 — Label fallback-degraded data (Stage 6)

- **Remediation:** New module [`lib/analysis/ingestion/quality.ts`](file:///workspace/lib/analysis/ingestion/quality.ts) → `classifyEnrichment(provider, enrichment)` yields `PRIMARY_COMPLETE` / `PRIMARY_PARTIAL` / `FALLBACK_PARTIAL` / `INSUFFICIENT_DATA` and the list of missing groups; `describeQuality` produces admin-facing text. The eligibility gate applies stricter rules on `FALLBACK_PARTIAL`.
- The superadmin results API [`app/api/superadmin/analysis/results/route.ts`](file:///workspace/app/api/superadmin/analysis/results/route.ts) exposes `dataQuality` (enrichment, provider, missing, oddsAvailable, oddsSource, oddsCapturedAt, fixtureStatus, seasonId, exclusionReason) so reviewers see degraded data and *why* markets were skipped.
- **Tests:** [`tests/analysis-enrichment-quality.test.ts`](file:///workspace/tests/analysis-enrichment-quality.test.ts).

### B7 — Evidence & confidence quality (Stage 7)

- **Findings / remediation:**
  - **Confidence is not a probability.** The model score is `50 + abs(direction − 50) × clamp(evidence, 0, 1)`; the API surfaces it additionally as `modelScore` and docs/labels no longer imply win probability. The 75 threshold is unchanged (model-score threshold).
  - **Missing evidence stays neutral.** One-sided missing xG yields a neutral direction (50), not a false zero — [`matchResultDirection`](file:///workspace/lib/analysis/markets/shared.ts#L63-L79) guards `homeXg !== undefined && awayXg !== undefined`.
  - **Placeholder injuries removed.** `fetchInjuries` no longer emits hard-coded `keyHome`/`keyAway` `0` (the provider does not identify "key" players); missing stays missing.
  - **No stub H2H.** `fetchH2H` returns `undefined` without both team ids (a stub would count as evidence).
  - **Ineligible markets never persist** (`toPersistableResult` throws if no eligible market).
- **Tests:** the evidence assertions live in [`tests/analysis-eligibility.test.ts`](file:///workspace/tests/analysis-eligibility.test.ts) (Over/Under missing side stays 50; direction neutral with one-sided xG) and the persistence guard.

---

## 3. Files changed

**New source (untracked):**
- `lib/analysis/markets/eligibility.ts` — market eligibility gate + policy.
- `lib/analysis/ingestion/quality.ts` — enrichment quality classification.
- `lib/analysis/ingestion/readiness.ts` — league readiness / entitlement assessment.
- `lib/analysis/ingestion/status.ts` — fixture status normalization.
- `lib/api/season.ts` — competition-aware season derivation.
- `prisma/migrations/0015_add_analysis_result_data_quality/` — additive migration.

**Modified source (28 files):**
- Engine / pipeline: `lib/analysis/engine.ts`, `lib/analysis/run.ts`, `lib/analysis/persistence.ts`.
- Markets (ten): `lib/analysis/markets/{matchResult,btts,overUnder,asianHandicap,doubleChance,correctScore,firstHalfResult,totalCorners,totalCards,playerScorer,shared}.ts`.
- Providers / ingestion: `lib/api/football-api.ts`, `lib/api/football-data.ts`, `lib/analysis/ingestion/{enrichment,fixtures}.ts`.
- Schema / types: `prisma/schema.prisma`, `types/analysis.ts`.
- Superadmin: `app/api/superadmin/analysis/results/route.ts`, `app/api/superadmin/analysis/results/[id]/publish/route.ts`.

**Tests:** new `tests/analysis-{eligibility,fixture-status,enrichment-quality,season,provider-schema}.test.ts`; updated `tests/analysis-{branches,db,engine,persistence,run,utils}.test.ts`; fixtures under `tests/fixtures/{api-football,football-data}/`.

---

## 4. Database changes (Stage 8)

Migration [`0015_add_analysis_result_data_quality`](file:///workspace/prisma/migrations/0015_add_analysis_result_data_quality/migration.sql) — **non-destructive, additive**:

- `ALTER COLUMN "bestOdds" DROP NOT NULL` (enables honest "no odds" instead of a fabricated price).
- `ADD COLUMN` (all nullable): `enrichmentQuality`, `providerSource`, `missingDataFields` (text[]), `marketEligibility` (jsonb), `marketExclusionReason`, `fixtureStatus`, `seasonId`, `oddsSource`, `oddsCapturedAt`.
- Two indexes: `@@index([enrichmentQuality])`, `@@index([seasonId])`.

Existing `AnalysisResult` rows are preserved (new columns are nullable; `bestOdds` only loses its NOT NULL). `prisma validate` passes; the client generates; migration `status`/replay verified against an **isolated local Postgres** only.

**Label:** schema + migration **VERIFIED** against local isolated Postgres; production DB application **NOT VERIFIED** (not run, per instruction).

---

## 5. Provider response evidence

| Fixture | Contents | Origin |
|---|---|---|
| `tests/fixtures/api-football/team-statistics.sample.json` | Nested `/teams/statistics` envelope (`fixtures`, `goals.for.total.total`, `biggest`, `clean_sheet`, `failed_to_score`, `penalty`, `lineups`, `cards`) | **Sanitized sample mirroring the documented v3 schema — not a live capture** |
| `tests/fixtures/api-football/fixtures.sample.json` | `/fixtures` envelope: valid `NS`, `PST`, `FT`, plus a malformed entry (missing away id) | Sanitized sample |
| `tests/fixtures/football-data/fixtures.sample.json` | v4 `/competitions/{code}/matches`: `TIMED`, `POSTPONED`, plus malformed (missing home id) | Sanitized sample |

**Honesty note:** Rule 4 requires verifying the schema mismatch with an **actual captured provider response**. No authorized live capture was performed in this environment (rule 9: no live requests without authorization; no production keys). Therefore the schema correction is **VERIFIED against the documented contract and the sibling-endpoint distinction**, but **live-call schema verification is NOT VERIFIED** and remains an outstanding production requirement (§12). No live response is claimed.

---

## 6. Current-season entitlement evidence

- Per-league `assessLeagueReadiness` output (season, strategy, `addressable`, `withinFreeTierSeason`) is **CALCULATED** from the static mapping table and the competition-aware derivation.
- **Live entitlement for the 20 leagues is NOT VERIFIED** — no authorized live probe was run; `entitlement` is hard-set to `NOT_VERIFIED` by design. A league whose data cannot be served is excluded **safely with a recorded reason**, never silently enabled.

---

## 7. Market eligibility matrix

| Market | Requirement | Stage-4 policy | Odds required? |
|---|---|---|---|
| Match Result | home & away scoring | eligible | no |
| BTTS | home/away scoring **and** conceding | eligible | no |
| Over/Under 2.5 | home & away scoring | eligible | no |
| Asian Handicap | captured bookmaker handicap line | self-gated | **yes** |
| Double Chance | home & away scoring | eligible | no |
| Correct Score | home & away scoring (Poisson safeguards) | eligible | no |
| First Half Result | verified first-half data | **DISABLED** | no |
| Total Corners | verified corner data (both teams) | **RESTRICTED** | no |
| Total Cards | cards + reliable referee data | **DISABLED** | no |
| Player Scorer | verified participants + player stats + market | **DISABLED** | no |

Criteria/decisions **VERIFIED** by [`tests/analysis-eligibility.test.ts`](file:///workspace/tests/analysis-eligibility.test.ts). Fallback-only enrichment additionally requires `homeForm`/`awayForm` (strict mode).

---

## 8. Fixture-status policy

Only `scheduled` (API-Football `TBD`/`NS`; Football-Data `SCHEDULED`/`TIMED`) is predictable.

| Provider status | Internal | Predictable |
|---|---|---|
| NS / TBD / SCHEDULED / TIMED | `scheduled` | ✅ |
| 1H / HT / 2H / ET / BT / P / LIVE / IN_PLAY / PAUSED | `in_play` | ❌ |
| FT / AET / PEN / FINISHED | `finished` | ❌ |
| PST / POSTPONED | `postponed` | ❌ |
| CANC / CANCELED / CANCELLED | `cancelled` | ❌ |
| ABD | `abandoned` | ❌ |
| SUSP / INT / SUSPENDED | `suspended` | ❌ |
| AWD / WO / AWARDED | `awarded` | ❌ |
| anything else / malformed | `unknown` | ❌ |

**VERIFIED** by [`tests/analysis-fixture-status.test.ts`](file:///workspace/tests/analysis-fixture-status.test.ts).

---

## 9. Fallback classification rules

| Class | Condition |
|---|---|
| `PRIMARY_COMPLETE` | API-Football, all groups present (homeStats, awayStats, odds, h2h, injuries, players) |
| `PRIMARY_PARTIAL` | API-Football, some groups missing |
| `FALLBACK_PARTIAL` | Football-Data with team stats (odds/h2h/injuries/xG/corners never supplied) |
| `INSUFFICIENT_DATA` | Nothing usable |

Rules **VERIFIED** by [`tests/analysis-enrichment-quality.test.ts`](file:///workspace/tests/analysis-enrichment-quality.test.ts). Fallback is surfaced to superadmins and never equated with complete primary data.

---

## 10. Tests executed and results

Full suite (not only new tests), run on the working tree:

| Command | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean (exit 0) |
| `npx vitest run` | ✅ **439 passed / 5 skipped** — 63 files passed, 1 skipped (64) |

The 5 skipped are the live-Postgres `tests/analysis-db.test.ts` cases (require `TEST_DATABASE_URL`; hermetic by default). New/updated suites cover: provider adapters, market eligibility, fixture filtering, confidence/evidence, and persistence/administration.

**Label:** suite result **VERIFIED** (executed). Production behavior **NOT VERIFIED**.

---

## 11. Remaining limitations

1. **No live provider verification.** The team-statistics schema fix and 20-league entitlement are verified only against documentation and sanitized samples, not a captured live response or a live entitlement probe. **NOT VERIFIED.**
2. **No backtest / calibration.** The 75 threshold is a model-score threshold, not a calibrated win probability; no accuracy claim is made.
3. **DB verification is local-only**; migration not applied to any production database.
4. **Product scope unchanged:** 20 leagues, 48-hour window, ten-market architecture and 75 threshold preserved.
5. Total Corners remains **RESTRICTED** (API-Football `/teams/statistics` provides no corner data today) and Total Cards / First Half Result / Player Scorer remain **DISABLED** by policy — re-enable only once their data sources are verified.

---

## 12. Outstanding production requirements

1. Run a **bounded, authorized live probe** (with already-configured production credentials) to:
   - capture the actual `/teams/statistics` response and confirm the nested schema against the corrected normalizer;
   - confirm current-season entitlement for all 20 leagues (record actual quota/entitlement).
2. Replace `entitlement: NOT_VERIFIED` with live evidence where obtainable; keep leagues unverified rather than enabled.
3. Apply migration `0015` to staging (isolated DB), then validate on staging records before any production migration.
4. Complete a historical backtest before making any probabilistic/accuracy claim.
5. Confirm the Vercel function-duration limit supports the analysis run; verify live DB pooling + Redis fail-closed behavior.

---

## Appendix — Evidence-label summary

| Item | Label |
|---|---|
| Fabricated-odds removal (B3) | VERIFIED (code + tests) |
| Market eligibility gating (B4) | VERIFIED (code + tests) |
| Fixture-status filtering (B5) | VERIFIED (code + tests) |
| Fallback classification (B6) | VERIFIED (code + tests) |
| Evidence/confidence honesty (B7) | VERIFIED (code + tests) |
| Team-statistics schema correction (B1) | schema shape CALCULATED; **live capture NOT VERIFIED** |
| Fixture mapping correction (B1.2) | VERIFIED against sanitized fixtures (tests) |
| Season derivation (B2) | CALCULATED (static mapping + tests) |
| 20-league live entitlement (B2) | **NOT VERIFIED** |
| DB migration 0015 | VERIFIED local isolated Postgres; production **NOT VERIFIED** |

---

# Stage 11 — Final Production Readiness Assessment

| Blocker | Status | Evidence | Files changed | Remaining risk |
|---|---|---|---|---|
| B1 — Provider data contract | **PARTIAL** | Nested schema corrected + fixture identity guards; sanitized fixture regression tests pass. Live capture not performed. | `lib/api/football-api.ts`, `lib/api/football-data.ts`, `lib/api/season.ts`, `tests/analysis-provider-schema.test.ts`, `tests/fixtures/**` | Live `/teams/statistics` shape unconfirmed; documented contract could differ in provider edge cases. |
| B2 — Current-season access (20 leagues) | **PARTIAL** | Competition-aware derivation + per-league readiness, tested. Entitlement hard-labelled NOT_VERIFIED. | `lib/api/season.ts`, `lib/analysis/ingestion/readiness.ts`, `tests/analysis-season.test.ts` | No live entitlement evidence; paid-tier requirement unresolved. |
| B3 — Fabricated odds | **PASS** | `oddsOrNull` returns null; Zod + persistence + publish guard; tests for missing/valid/malformed/zero. | `lib/analysis/markets/shared.ts` + all markets, `lib/analysis/persistence.ts`, publish route, tests | None code-side. |
| B4 — Market eligibility gates | **PASS** | Eligibility-gated engine; policy disables 3, restricts 1, self-gates AH; structured decisions; 15 tests. | `lib/analysis/markets/eligibility.ts`, `lib/analysis/engine.ts`, `tests/analysis-eligibility.test.ts` | Corner/card data still unavailable (markets intentionally gated). |
| B5 — Invalid fixture statuses | **PASS** | Central normalization + `isPredictableStatus` + `partitionByStatus`; 7 tests across all statuses. | `lib/analysis/ingestion/status.ts`, `lib/analysis/ingestion/fixtures.ts`, `tests/analysis-fixture-status.test.ts` | Provider may add new codes → mapped to `unknown` (conservative). |
| B6 — Fallback-degraded data | **PASS** | 4-class quality model + missing-field list + admin `dataQuality`; 6 tests. | `lib/analysis/ingestion/quality.ts`, superadmin results route, `tests/analysis-enrichment-quality.test.ts` | Real fallback behavior unexercised live. |
| B7 — Evidence / confidence | **PASS** | Neutral-on-missing direction, no placeholder injuries, no stub H2H, ineligible never persist; tests. | `lib/analysis/markets/shared.ts`, `lib/api/football-api.ts`, `lib/analysis/persistence.ts`, tests | No calibration/backtest (explicitly out of scope). |

## Final verdict

### **CONDITIONALLY READY**

The code-side remediation is complete and safe: fabricated odds are eliminated, unsupported markets are gated in the backend, invalid fixture statuses are excluded, fallback data is honestly labelled and shown to superadmins, and evidence cannot be inflated by missing/synthetic values. The full suite passes (`439 passed / 5 skipped`) and `tsc` is clean.

Production readiness is **conditioned on two non-code items**, exactly as the prior independent audits concluded:

- **(a)** a bounded, **authorized live probe** to confirm the real `/teams/statistics` schema and current-season entitlement for all 20 leagues (B1/B2 remain **PARTIAL / NOT VERIFIED**); and
- **(b)** applying migration `0015` to staging and validating it on staging data before production.

**There is no reason to believe the pipeline would emit a fabricated or ungated pick on a first run** — but live provider mapping and entitlement have not been demonstrated by evidence here, and per the brief "a passing test suite alone does not establish production readiness." Do not promote to a real-user run until (a) and (b) are cleared.

*No deployment, commit, push, migration, or production execution was performed. Changes are staged in the working tree for review.*
