# PredictPro — Phase 1 Production Readiness Audit

**Audit date:** 2026-11-22
**Repository:** `Kelly883/Prediction-claude-`
**Audited commit:** `c875450` (main, after squash-merge of PR #78)
**Scope:** `PRD_Phase1_Foundation.md` (Phase 1 Foundation — Weeks 1–2)
**Audit type:** Read-only, evidence-based verification. No application code was modified during this audit.

> Cross-reference: the fuller product PRD (`PRD_Superadmin_Daily_Match_Analysis.md`) describes a 4‑phase
> program. Phase 1 explicitly defers the dashboard UI, backtest, notifications and settings panel
> (`PRD_Phase1_Foundation.md` §3 "OUT"). Those items are therefore assessed as **deferred by design**, not as
> Phase 1 failures — but their absence has knock-on effects on the statistical-validity requirements that
> this audit is explicitly asked to test.

---

## 1. Executive Summary

The Phase 1 code artefacts (Prisma models, migrations, seed, provider adapters, ingestion pipeline,
10‑market engine, superadmin API, publish workflow, audit hooks) are **present, coherent and largely
well-built**. The full automated suite passes (**293 tests / 50 files**), and `lint`, `tsc --noEmit`,
`prisma validate`, `prisma generate`, `npm run check-routes` and `next build` all pass cleanly.

However, three categories of problem prevent a production-ready verdict:

1. **Data-provider feasibility is broken/unverified (CRITICAL).** The 20 internal league codes are
   assumed to be valid identifiers for *both* providers. They are not.
   * Football-Data.org's **free tier covers only 12 competitions**, and two of the internal codes
     (`ERE`, `BRA`) are the *wrong* identifier for that provider (`DED`, `BSA` are correct). Ten of the
     twenty configured leagues (`EL`, `ECL`, `BL2`, `PD2`, `SA2`, `FL2`, `MLS`, `LIB`, `J1`, `ARG`) are
     **not available on the free tier at all**.
   * API-Football's `/leagues` endpoint documents **no `code` query parameter** (it uses numeric ids /
     `name`), yet `leagueIdForCode()` looks leagues up by `code`. If unsupported, API-Football fixture
     resolution always returns "no league id" and the run silently degrades to Football-Data.
   * API-Football's **free plan caps at 100 requests/day** and only exposes seasons `Year-4 … Year-2`
     (2022–2024 in 2026), while enrichment requests `season = kickoff year` (2026). A single fixture's
     enrichment issues ≥6 upstream calls. The 20‑league daily pipeline is therefore **not achievable on
     the free tier as configured**, which contradicts the Phase 1 North Star.

2. **The "≥75% confidence" number is a heuristic model score, not a calibrated probability
   (HIGH).** The engine computes `confidence` as a weighted, evidence-scaled heuristic
   (`50 + |direction−50| × evidenceRatio`). There is **no backtest, no calibration curve and no
   historical validation** in Phase 1 (explicitly deferred). Labelling these values as confidence
   percentages implies probabilistic meaning that the code does not substantiate.

3. **Database-dependent gates could not be executed (BLOCKED).** No database is reachable from the audit
   environment. Migration replay, seed idempotency execution, `prisma migrate status`, and the live
   `POST /api/cron/daily-analysis` run are **unverified**.

A successful build is explicitly **not** treated as proof of readiness.

---

## 2. Overall Production-Readiness Status

**Status: NOT PRODUCTION READY** (see §9).

The API-only Phase 1 surface is functionally complete and well-secured, but the system's *core purpose*
— automated daily ingestion of 20 leagues from free providers and production of statistically
meaningful ≥75% picks — is **not demonstrably achievable** on the configured data sources, and the
confidence semantics are unvalidated. Critical requirements are broken and/or unverified.

---

## 3. Production Readiness Percentage

| Category | Status | Credit |
|---|---|---|
| 1. Database foundation | PARTIAL | 0.5 |
| 2. Data providers | FAIL | 0.0 |
| 3. Fixture ingestion | PARTIAL | 0.5 |
| 4. Data enrichment | PARTIAL | 0.5 |
| 5. 10-market engine | PARTIAL | 0.5 |
| 6. Confidence threshold | PASS | 1.0 |
| 7. Result storage | PARTIAL | 0.5 |
| 8. Superadmin authorization | PASS | 1.0 |
| 9. Approval and publishing | PASS | 1.0 |
| 10. Audit logging | PARTIAL | 0.5 |
| 11. Automated tests | PARTIAL | 0.5 |
| 12. Security | PARTIAL | 0.5 |
| 13. Deployment and cron | PARTIAL | 0.5 |
| 14. Performance | PARTIAL | 0.5 |

**Overall readiness ≈ 57%** (8.0 of 14 category-credits; PASS = 1.0, PARTIAL = 0.5, FAIL/BLOCKED = 0.0).

This figure reflects *verified* capability, not the number of files present. Because the DB-dependent
verification gates could not run, the true value is likely **lower** until those gates pass.

---

## 4. Complete Requirements Verification Matrix

Legend: ✅ PASS · 🟡 PARTIAL · ❌ FAIL · ⛔ BLOCKED · ➖ DEFERRED BY PRD

### A. Database Foundation

| Requirement | Status | Evidence |
|---|---|---|
| `AnalysisRun` model fields/types correct | ✅ | `prisma/schema.prisma` L377–392 |
| `AnalysisResult` model fields/types correct | ✅ | `prisma/schema.prisma` L394–422 |
| `AnalysisConfig` model correct | ✅ | L424–433 (`key @unique`) |
| `LeagueConfig` model correct | ✅ | L435–444 (`leagueName @unique`, `leagueCode @unique`) |
| FK constraints | ✅ | `prisma/migrations/0012_add_daily_analysis/migration.sql` L84–90 |
| Cascade deletion (`AnalysisResult.runId`) | ✅ | `onDelete: Cascade` schema L397; migration L84 |
| Unique constraints | ✅ | config key, league name/code, `AnalysisResult.predictionPostId @unique` |
| Indexes | ✅ | `AnalysisRun(runDate,status)`; `AnalysisResult(runId/confidence/status)` |
| Decimal precision for odds/confidence | ✅ | `bestOdds Decimal(6,2)`, `confidence Decimal(5,2)` |
| JSON field integrity (`marketScores`,`topFactors`) | 🟡 | `Json` columns, no schema-level validation of shape |
| Migration integrity | 🟡 | SQL reviewed, static validate passes; **replay not executed** |
| Migration rollback feasibility | 🟡 | Forward-only migrations (no down scripts); rely on reset |
| Seed reliability / idempotency | 🟡 | `upsert`-based (`prisma/seed.mjs`); **not executed** |
| Duplicate prevention during seed | ✅ | unique keys + upsert |
| 20 leagues present with correct codes | ✅ | `lib/analysis/defaults.json` L4–25 (exactly the 20 codes) |
| All enabled by default | ✅ | seed `isEnabled: true` L22 |
| Priority initialised | ✅ | all `priority: 1` (equal priority — acceptable) |
| Duplicate league config impossible | ✅ | unique `leagueCode` + `leagueName` |
| Default configs & market weights seeded | 🟡 | seeded **only if a superadmin exists** (seed.mjs L45) |

**Data-quality finding (LOW/MEDIUM):** `defaults.json` labels `LIB` = "Argentina Liga Profesional" and
`ARG` = "Argentina Primera Division" — two Argentine entries. The full PRD (Assumption A2) defines
`LIB` = **Liga MX**. The league *name* for `LIB` is therefore inconsistent with the PRD.

### B. Football Data Provider Integration

| Requirement | Status | Evidence |
|---|---|---|
| Correct base URLs | ✅ | API-Football `https://v3.football.api-sports.io` (`lib/api/football-api.ts` L5); Football-Data `https://api.football-data.org/v4` (L5) |
| Correct auth headers | ✅ | `x-apisports-key` (L23); `X-Auth-Token` (L15) |
| API key handling | ✅ | env-only, throws if unset |
| Request/response validation | 🟡 | type-cast responses; API-Football `errors` object checked (L29) |
| Timeout handling | ✅ | `AbortSignal.timeout(TIMEOUT_MS)` (default 10 s) |
| Rate-limit (429) handling | ❌ | no 429 / `Retry-After` handling; relies on generic `!response.ok` throw |
| Retry & backoff | ❌ | none implemented |
| Provider fallback | ✅ | `fetchFixtures` iterates `dataSourcePriorities` (`ingestion/fixtures.ts` L37–46) |
| Request caching | 🟡 | Redis cache, **24 h default**, but falls back to **per-instance in-memory** (`lib/redis.ts`) |
| Cache expiration | ✅ | `FOOTBALL_CACHE_TTL_SECONDS` default 86400 |
| Duplicate fixture prevention | ✅ | `dedupeFixtures` by `source:id` (fixtures.ts L54–61) |
| Provider league-ID mapping | ❌ | **See critical finding below** |
| Fixture normalisation | ✅ | `normalizeFixture` both adapters |
| Timezone handling | 🟡 | date-only UTC window (`fixtures.ts` L8–17) — tournament/timezone edge cases untested |
| Missing-data handling | ✅ | `safe()` wrappers; stats default to 50 |
| API error logging | 🟡 | errors accumulated into `enrichment.errors`; provider errors collected, not centrally logged |

**CRITICAL — provider league-code mapping (verified against provider docs):**
* Football-Data.org free tier = **12 competitions**: PL, ELC, BL1, SA, PD, FL1, **DED**, PPL, **BSA**,
  CL, EC, WC. Internal codes `ERE`/`BRA` are the wrong identifiers (should be `DED`/`BSA`); `EL`, `ECL`,
  `BL2`, `PD2`, `SA2`, `FL2`, `MLS`, `LIB`, `J1`, `ARG` are **not in the free tier**. The adapter passes
  the internal code straight into `/competitions/${code}/matches` (`football-data.ts`), so those calls
  404 and are swallowed per-league.
* API-Football `/leagues` documented parameters are `id`, `name`, `season`, `team`, `country` — **no
  `code`**. `leagueIdForCode()` (`football-api.ts` L39–46) will therefore return `undefined` for every
  league, causing "no API-Football league id" for all 20 and a silent fallback to Football-Data.
* API-Football **free plan = 100 requests/day**, seasons `Year-4…Year-2` only. Enrichment uses
  `season = fixture.kickoff.getUTCFullYear()` (2026) → not entitled on the free plan → empty stats.
* Net effect: the guaranteed, PRD-mandated path for 20 leagues **cannot deliver 20-league coverage on
  the free tier**. This must be resolved (paid tier, code remapping, league-list reduction, or an
  alternate provider) before production.

### C. Fixture Ingestion (`POST /api/cron/daily-analysis`)

| Requirement | Status | Evidence |
|---|---|---|
| CRON_SECRET mandatory | ✅ | `app/api/cron/daily-analysis/route.ts` L11–15, timing-safe compare |
| Unauthorised rejected | ✅ | returns 401; covered by `tests/analysis-api.test.ts` |
| Fetches next 48 h | ✅ | `FIXTURE_WINDOW_HOURS = 48` |
| All enabled leagues considered | ✅ | `getEnabledLeagues()` filters `isEnabled: true` |
| Disabled leagues excluded | ✅ | same query |
| Duplicate fixtures not reprocessed | 🟡 | dedupe within one run; **no cross-run de-dup** (a fixture appearing on 2 days can be re-scored) |
| Provider fallback works | ✅ | documented + adapter tests |
| Partial failures don't kill the run | ✅ | per-league `try/catch`; per-fixture enrichment `safe()` |
| Total provider failure → run failed | ✅ | `All fixture providers failed` thrown → run marked `failed` (`run.ts` L135–141) |
| Run start/completion timestamps | ✅ | `startedAt`/`completedAt` set |
| Fixture/pick counts accurate | 🟡 | counts derived from arrays; not asserted against DB |
| Concurrent executions don't duplicate | 🟡 | Redis `NX` lock + pre-lock idempotency check; **race window** and **in-memory fallback defeats the lock** on serverless |
| Failed runs retriable safely | ✅ | `rerun` route creates a new run |
| Completes within realistic limits | ❌ | 100 req/day cap + ≥6 calls/fixture makes this infeasible across 20 leagues |

### D. Data Enrichment

| Source | Status | Notes |
|---|---|---|
| Team statistics | 🟡 | Full via API-Football; Football-Data only goals/form from standings |
| Head-to-head | 🟡 | API-Football only; absent when Football-Data is the active provider |
| Injuries | 🟡 | API-Football only; `keyHome/keyAway` hard-coded to 0 |
| Odds | 🟡 | API-Football only; `AsianHandicap.line`, `TotalCorners/Cards.line` not captured |
| Weather | ✅ | Open-Meteo (a **third** provider not listed in PRD §8); degrades gracefully |
| Team/fixture mapping | ✅ | id-based with name fallback |
| Freshness / cache | ✅ | 24 h cache (in-memory fallback weakens it) |
| Timeout | ✅ | 10 s per call |
| Missing-data → controlled adjustment | ✅ | `evidenceScore` lowers confidence to 50 when data absent (`utils/confidence.ts` L40–46) |
| Missing data never treated as positive | ✅ | defaults are neutral (50), never above neutral |

### E. Prediction Analysis Engine (10 markets)

| Requirement | Status | Evidence |
|---|---|---|
| Each market has independent calculation | ✅ | 10 modules under `lib/analysis/markets/` |
| Market weights correct | ✅ | `defaults.json` factors match PRD §6 per market |
| Factor scores normalised consistently | ✅ | `normalize`, `weightedScore` |
| Missing values handled safely | ✅ | neutral defaults; `weightedScore` returns 50 if no weight |
| Deterministic confidence | ✅ | no RNG; unit test asserts `first === second` |
| Invalid input can't produce misleading confidence | ✅ | NaN/Infinity guarded (`clamp`/`round2`) |
| Configurable weights validated | ✅ | `validateConfigUpdate` |
| Weight totals normalised/rejected | 🟡 | per-market positive-total check; **sum=1 not enforced** (normalisation makes it safe) |
| No NaN / Infinity | ✅ | guards in `utils/confidence.ts` |
| Reproducible from same input+config | ✅ | deterministic |
| **Double Chance consistent with Match Result** | ❌ | Separate weighted score; selection is only `X or Draw` (never `Home or Away`); not derived from MR probabilities |
| **Correct Score = defensible statistical model** | ❌ | `poisson` factor is a hand-tuned expression, **not** a Poisson PMF; selection = rounded expected xG |
| Player Scorer uses player-specific data | ✅ | goals/minutes/penalties/position per player |
| **Asian Handicap reflects actual line/outcome** | ❌ | line hard-coded `-0.5`; the captured `odds.asianHandicap.line` is ignored |
| Correct market selected among qualifiers | 🟡 | Highest-confidence market only; ties broken by `MARKET_ORDER` |
| Multiple qualifying markets handled per PRD | 🟡 | PRD §7.2 says "best market per fixture" → **one result per fixture**; matches PRD, but see note |

**CRITICAL STATISTICAL VALIDATION — confidence semantics.**
`confidence = 50 + |direction − 50| × evidenceRatio` (`utils/confidence.ts` L40–46). This is a
*heuristic model score* scaled by data availability — it is **not** a calibrated probability. A value of
75 means "network of factors leans strongly in one direction *and* enough inputs were present", not
"75% chance of winning". No backtesting, calibration curve, or historical accuracy evidence exists in
Phase 1 (backtest is deferred), so the PRD's own acceptance criterion
"Backtest shows ≥85% accuracy on ≥75% picks" and success metric "≥85% of ≥75% picks correct" are
**unmet / unverified**. The dashboard/reporting must therefore not present these numbers as win
probabilities.

### F. Confidence Threshold (75%)

| Requirement | Status | Evidence |
|---|---|---|
| Results below 75 excluded | ✅ | `filterPicks` uses `>=` |
| Results equal to 75 included | ✅ | `outcome.best.confidence >= threshold` (`engine.ts` L52) |
| Results above 75 included | ✅ | same |
| Decimal precision handled | ✅ | `confidence Decimal(5,2)`, `round2` |
| Threshold configuration respected | ✅ | loaded from `analysisConfig` |
| Changing config doesn't corrupt previous runs | ✅ | threshold read at run start; stored results immutable |
| System doesn't artificially inflate confidence | ✅ | no boost logic; missing data reduces it |

### G. Analysis Result Storage

| Requirement | Status | Evidence |
|---|---|---|
| AnalysisRun creation | ✅ | `run.ts` L87 |
| AnalysisResult creation | ✅ | `createMany` (`run.ts` L99–116) |
| Correct fixture relationships | ✅ | FK `runId → AnalysisRun` |
| Market info / odds / confidence stored | ✅ | columns populated |
| `marketScores` / `topFactors` JSON integrity | 🟡 | stored as JSON; `topFactors` limited to 3 & rounded |
| Duplicate prevention | 🟡 | `predictionPostId @unique`; **no unique key on (runId, fixtureId)** |
| Transaction handling | ❌ | `createMany` then a **separate** `analysisRun.update` — not atomic; a failure between them leaves a `running` run *with* stored results |
| Status transitions | ✅ | see §H/§I |
| Review history | ✅ | `reviewedById/reviewedAt/dismissalReason` |
| Published prediction relationship | ✅ | `predictionPostId` FK, `@unique` |

### H. Superadmin Authentication & Authorization

All seven endpoints exist and are gated by `requireAnalysisAdmin` →
`requireSameOrigin` + (`requireCsrf` on mutations) + `requireSuperAdmin`
(`lib/analysis/api-auth.ts`, `lib/rbac.ts` L68–81). `requireSuperAdmin` additionally **enforces 2FA**
on the superadmin account.

| Caller | Expected | Status |
|---|---|---|
| Unauthenticated visitor | denied (401) | ✅ (via `requireUser` missing-token branch) |
| Regular user | denied (403) | ✅ |
| Ordinary admin (`role: admin`) | denied (403) | ✅ |
| Authorised superadmin (2FA enabled) | allowed | ✅ |

| Control | Status |
|---|---|
| Role enforcement | ✅ server-side `requireSuperAdmin` |
| No authorization bypass | ✅ middleware is defence-in-depth; APIs re-check |
| No IDOR | ✅ all analysis data is superadmin-global (no per-user ownership) |
| Input validation | ✅ zod schemas |
| Pagination limits | ✅ `MAX_PAGE_SIZE = 100` |
| Filtering validation | ✅ status allow-lists, ISO date regex |
| Mass-assignment protection | ✅ explicit field mapping |
| Safe error responses | ✅ `errorResponse` returns generic 500 |

### I. Approval, Dismissal & Publishing

Pending → Approved → Published, and Pending → Dismissed are correctly enforced
(`results/[id]/route.ts`, `results/[id]/publish/route.ts`).

| Requirement | Status |
|---|---|
| Only superadmins approve/dismiss | ✅ |
| Dismissal requires reason | ✅ (`400` if missing) |
| Review timestamp accurate / reviewer recorded | ✅ |
| Invalid status transitions rejected | ✅ (`published` cannot be re-reviewed) |
| Already-published can't republish | ✅ (`409` when `predictionPostId` set) |
| Publish requires manual booking code | ✅ (`bookingCode min(1)`) |
| Missing booking code rejected | ✅ (zod 400) |
| PredictionPost created correctly | ✅ |
| Result↔Post consistency | ✅ single `$transaction` |
| Publish protected by transaction | ✅ |
| Duplicate publishing prevented | ✅ `@unique` + status guard |
| Actions auditable | ✅ `analysis.pick.approve/dismiss/publish` |
| **No auto booking-code generation in Phase 1** | ✅ none present |

### J. Audit Logging

| Requirement | Status | Evidence |
|---|---|---|
| Config changes logged | ✅ | `analysis.config.update` |
| Approvals logged | ✅ | `analysis.pick.approve` |
| Dismissals logged | ✅ | `analysis.pick.dismiss` |
| Publishing logged | ✅ | `analysis.pick.publish` |
| Run + rerun logged | ✅ | `analysis.run`, `analysis.run.rerun`, `analysis.run.delete` |
| Actor recorded | 🟡 | actor set for admin actions; **cron run logs `actorId: null`** |
| Action type / target / timestamp | ✅ | `AuditLog` model |
| **Before/after values captured** | ❌ | config audit stores **new value only**, no prior value (PRD §11.1 asks for before/after) |
| Logs not modifiable by ordinary users | ✅ | read-only `GET /api/admin/audit-logs`; no user-facing mutation |
| Secrets never logged | ✅ | `redact()` key denylist in `lib/audit.ts` |

---

## 5. Implemented Features (verified working)

* 4 Prisma models + migration `0012` with FK cascade, unique + secondary indexes, correct decimal precision.
* Idempotent, upsert-based seed for 20 leagues and 3 config keys.
* `POST|GET /api/cron/daily-analysis` with timing-safe `CRON_SECRET`, 48 h window, provider fallback,
  partial-failure tolerance, Redis lock, idempotent re-runs.
* Two provider adapters with correct URLs/headers/timeouts/caching and a shared fallback order.
* 10 independent, deterministic, NaN-safe market scorers with explainable top factors.
* Inclusive `>= 75` threshold with validated (50–99) configuration.
* 7 superadmin analysis endpoints with same-origin + CSRF + superadmin + 2FA enforcement and pagination.
* Full pending→approved→published / pending→dismissed workflow with transactional publishing and manual
  booking code.
* Audit hooks for config, approve, dismiss, publish and run actions with secret redaction.

## 6. Partially Implemented Features

* Provider integration: caching/fallback present, but **no retry/backoff, no 429 handling**.
* Enrichment: complete on API-Football; **h2h/injuries/odds absent when Football-Data is active**.
* Result storage: counts and records correct, but run finalisation is **not in a single transaction**.
* Audit: actor/action/target/timestamp present; **before-values missing** for config changes.
* Concurrency: Redis `NX` lock exists but **degrades to a non-distributed in-memory store**, weakening it.
* Engine: 9 of 10 markets are sound; **Double Chance / Correct Score / Asian Handicap** deviate from the
  PRD's stated models.

## 7. Missing (relative to Phase 1 PRD)

* **A valid league-code mapping for both providers** (CRITICAL — see §2.B).
* Retry/backoff and explicit rate-limit handling for provider calls.
* League enable/disable management endpoint (LeagueConfig is seeded but there is no API to toggle it).
* Per-league `marketWeights` overrides are stored but **never read** by the engine.
* Coverage-measurement tooling (`@vitest/coverage-v8` not installed; no coverage script/config).
* Notifications (email + in-app) — **deferred by PRD §3**, listed here for completeness.

## 8. Broken / Non-functional

* **API-Football league resolution** (`leagueIdForCode` uses an undocumented `code` parameter) →
  realistically resolves no leagues.
* **Football-Data free-tier coverage** → 10 of 20 leagues are unsupported; 2 codes are wrong.
* **API-Football free-plan season window** → 2026 season not entitled → empty team stats.
* **20-league daily ingestion** is not achievable within free-tier quotas.

---

## 9. Security Vulnerabilities

Dependency posture is **clean**: `npm audit` (against npmjs.org registry) reports **0 vulnerabilities**.
AuthN/AuthZ controls are strong: JWT access token, server-side role checks, superadmin 2FA, CSRF
double-submit, same-origin rejection, timing-safe secret comparisons, zod input validation, secret
redaction in audit logs, and no secrets in client bundles.

| # | Severity | Finding | Location | Impact | Remediation |
|---|---|---|---|---|---|
| S1 | MEDIUM | In-memory Redis fallback is per-instance/non-distributed | `lib/redis.ts` L19–48 | Distributed lock (dedupe cron) and 24 h cache silently no-op across serverless instances → duplicate runs, higher API usage | Fail closed or require Upstash in production; assert config at boot |
| S2 | LOW | `dangerouslySetInnerHTML` with `JSON.stringify` (JSON-LD) | `app/page.tsx`, `app/leagues/*`, `components/Breadcrumbs.tsx` | `JSON.stringify` does **not** escape `<`; static data today = low risk, but a future dynamic value could break out of the `<script>` | Escape `<`, `>`, `&` (e.g. `serialize-javascript` or a manual replacer) |
| S3 | LOW | Static security scan never fails the build | `scripts/security-scan.mjs`; `.github/workflows/ci.yml` | Regex-only, exit 0 always → gives false assurance; also false-positives on JSON-LD | Gate on real findings or mark the job informational; supplement with CodeQL (already present) |
| S4 | LOW | No edge guard branch for `/superadmin/*` | `middleware.ts` L65 | Matcher lists `/superadmin/analysis/:path*` but no role branch handles it | Add a superadmin branch (defence-in-depth; APIs already enforce) |
| S5 | INFORMATIONAL | Localhost HTTP fallbacks | `lib/env.ts` L72, `lib/seo/metadata.ts` | Dev-only defaults | Ensure `APP_URL` is set in production |
| S6 | INFORMATIONAL | Audit before-values not captured | `config/route.ts` L54–60 | Reduced forensic value on config drift | Store `{before, after}` |

No SQL-injection (Prisma ORM parameterises), no XSS via user content in the analysis surface, and no
mass-assignment exposure were found. **Do not weaken any of these controls to pass tests.**

---

## 10. Statistical & Prediction-Engine Concerns

1. **Confidence is not a probability.** `50 + |direction−50| × evidenceRatio` is a heuristic score.
   The ≥75% gate selects *strong-leaning, well-covered* fixtures, not 75%-likely winners.
2. **No calibration evidence.** Backtest is deferred to later phases, so there is no accuracy, ROI or
   calibration data to support the numbers or the PRD's "≥85% accuracy" acceptance criterion.
3. **Double Chance** is not derived from Match-Result probabilities and omits the `Home or Away` option.
4. **Correct Score** uses a hand-tuned expression mislabelled as "poisson", not a Poisson distribution.
5. **Asian Handicap** hard-codes a `-0.5` line and ignores the actual captured line.
6. **One pick per fixture** (the arg-max market). This matches PRD §7.2, but reviewers should confirm the
   intent, since several markets per fixture can exceed 75%.

---

## 11. Data-Provider Limitations

* Football-Data.org free tier: **12 competitions**, 10 calls/min, delayed scores; ten configured leagues
  unsupported; `ERE`/`BRA` mis-coded.
* API-Football free tier: **100 requests/day**, season window 2022–2024 only; `/leagues` has no `code`
  parameter.
* Open-Meteo is introduced for weather but is **not listed** in PRD §8 (acceptable, but undocumented).
* Net: the free-tier data budget is insufficient for 20-league, multi-endpoint daily enrichment.

## 12. Database & Migration Findings

* Schema is valid; `prisma validate` and `prisma generate` pass. Migration `0012` matches the schema.
* **BLOCKED:** `prisma migrate status` → `P1001 Can't reach database server at localhost:5432`.
* **BLOCKED:** migration replay (`prisma migrate reset --force`) and seed execution were **not run**
  (rule 11: no destructive DB actions without authorisation / no DB available).
* Migrations are forward-only; rollback is via reset, not a `down` script.
* No DB-level uniqueness on `AnalysisRun(runDate)` → duplicate same-day runs are possible (see S1).

## 13. Automated Test Results

| Command | Exit | Result |
|---|---|---|
| `npm run lint` | 0 | ✅ clean |
| `npx tsc --noEmit` | 0 | ✅ clean |
| `npm run test:unit` | 0 | ✅ 16 passed (2 files) |
| `npm run test:integration` | 0 | ✅ 6 passed |
| `npm run test:auth` | 0 | ✅ 4 passed |
| `npx vitest run` (full suite) | 0 | ✅ **293 passed / 50 files** |
| `npx prisma validate` (with env) | 0 | ✅ valid |
| `npx prisma generate` | 0 | ✅ generated |
| `npm run build` | 0 | ✅ succeeded |
| `npm run check-routes` | 0 | ✅ no conflicts |
| `node scripts/security-scan.mjs` | 0 | ⚠️ advisories only (see S2/S3) |
| `npm audit --registry=https://registry.npmjs.org` | 0 | ✅ 0 vulnerabilities |
| `npx prisma migrate status` | (1) | ⛔ P1001 — DB unreachable |

**Coverage:** the PRD requires **≥90% engine coverage**, but **no coverage provider is installed**
(`@vitest/coverage-v8` absent) and no coverage script/config exists → the target is **unmeasurable**.
The authz test covers origin/CSRF/superadmin-allow but **not** the four caller roles (unauthenticated,
user, admin, superadmin) as a matrix. Scenario tests explicitly requested by the audit brief — rate
limiting, provider outage, concurrent cron, invalid market weights, threshold boundaries, invalid status
transitions, duplicate publishing, DB transaction failure — are **not all present**.

## 14. Deployment & Cron Findings

* `vercel.json` schedules `/api/cron/daily-analysis` at `0 6 * * *` = **06:00 UTC** ✅.
* Route declares `runtime='nodejs'`, `maxDuration=300` (5 min) — matches PRD "<5 minutes".
* **Cron on Vercel requires a Pro plan for the 300 s limit**; on Hobby the ceiling is far lower. Verify
  the plan, or the run will be killed mid-flight.
* Given provider rate limits, the pipeline **cannot** complete across 20 leagues inside any 300 s window
  in practice (it will be throttled/failed).
* No error-monitoring integration; no automatic retry of failed runs; backup/restore and secret-rotation
  guidance exist in `docs/`.

## 15. Performance & Reliability Findings

* Concurrency is bounded at **10** and each enrichment call times out at **10 s** — both are enforced
  (`ingestion/enrichment.ts` L6, adapters). ✅
* Each fixture triggers a **fan-out of ≥6 upstream calls** (2× team stats, h2h, injuries, odds, scorers)
  plus weather — an **N+1-style amplification** that overwhelms free-tier quotas.
* Cache effectiveness is undermined by the in-memory Redis fallback (S1).
* No cross-run fixture de-duplication; no circuit breaker around unhealthy providers.
* `createMany` + separate run-update is a two-step non-atomic finalisation (see §6/G).

---

## 16. Prioritised Remediation Plan

**P0 — must fix before release**
1. **Fix provider league mapping.** Build an explicit `internalCode → {apiFootballId, footballDataCode}`
   map; remap `ERE→DED`, `BRA→BSA`; drop or flag leagues unavailable on the chosen tier; verify each
   against live provider responses. (Blocks the Phase 1 North Star.)
2. **Resolve the data budget.** Move to a paid API-Football tier (or reduce leagues / batch endpoints),
   and request the correct entitled `season`. Re-verify end-to-end ingestion.
3. **Correct the confidence semantics.** Either validate/calibrate (backtest) or rename the field in the
   UI/API to a non-probabilistic "model score" and document it.

**P1 — high**
4. Add provider **retry/backoff** and **429 `Retry-After`** handling.
5. Make run finalisation **atomic** (`$transaction` around createMany + update); consider a unique
   `AnalysisRun(runDate)` guard.
6. Require a **real distributed Redis in production** (fail closed if unset).
7. Add and wire **coverage tooling** (`@vitest/coverage-v8`) with an engine threshold ≥90%.

**P2 — medium**
8. Capture **before/after** in config audit logs; record the cron actor.
9. Implement retry-safe **cross-run fixture de-duplication**.
10. Remove a hard dependency on JSON-LD `dangerouslySetInnerHTML` (escape `<`).

**P3 — low / informational**
11. Correct the `LIB` league name to match the PRD (Liga MX).
12. Add league enable/disable + per-league weight endpoints (currently unconfigurable via API).

---

## 17. Exact Commands Used

```bash
# Repository / branch
git checkout main && git pull --ff-only
git log --oneline -3

# Static verification
npm run lint
npx tsc --noEmit
npx prisma validate            # fails P1012 without env; passes with dummy DATABASE_URL/DIRECT_URL
npx prisma generate
npm run check-routes
node scripts/security-scan.mjs

# Tests
npm run test:unit
npm run test:integration
npm run test:auth
npx vitest run

# Build (dummy env, mirrors CI)
npm run build

# Security
npm audit --registry=https://registry.npmjs.org --audit-level=low   # → 0 vulnerabilities

# Database (BLOCKED — no DB)
npx prisma migrate status      # → P1001 Can't reach database server at localhost:5432
```

## 18. Evidence & File References

* Schema: `prisma/schema.prisma` (L350–444); migration `prisma/migrations/0012_add_daily_analysis/migration.sql`
* Seed: `prisma/seed.mjs`; defaults `lib/analysis/defaults.json`
* Engine: `lib/analysis/engine.ts`, `lib/analysis/config.ts`, `lib/analysis/utils/{confidence,normalization}.ts`,
  `lib/analysis/markets/*.ts`
* Pipeline: `lib/analysis/run.ts`, `lib/analysis/ingestion/{fixtures,enrichment,cache,weather}.ts`
* Adapters: `lib/api/football-api.ts`, `lib/api/football-data.ts`
* API: `app/api/cron/daily-analysis/route.ts`, `app/api/superadmin/analysis/**`
* Security: `lib/rbac.ts`, `lib/csrf.ts`, `lib/audit.ts`, `lib/timing-safe.ts`, `lib/redis.ts`, `middleware.ts`
* Tests: `tests/analysis-{engine,adapters,api,authz}.test.ts`
* Deployment: `vercel.json`, `.github/workflows/ci.yml`, `.github/workflows/security.yml`, `.env.example`
* Provider coverage (external): football-data.org Coverage/Pricing (free tier = 12 competitions);
  api-football getting-started / docs (free tier = 100 req/day; `/leagues` params `id/name/season/team`)
* Git: main HEAD `c875450` (PR #78 merged: `verification/commands.json` + bootstrap scripts)

---

## Final Production Decision

### **C. NOT PRODUCTION READY**

Rationale: core, PRD-mandated requirements are **broken or unverified**. The configured free-tier
providers **cannot deliver the 20-league daily ingestion** the Phase 1 North Star depends on (verified
against provider documentation), the **≥75% "confidence" is an uncalibrated heuristic** with no
supporting validation, and the **database/migration/seed and live-run gates could not be executed**.
The API surface is well-implemented and well-secured, and all executable tests pass — but per the audit
rules, passing builds and green unit tests are not proof of production readiness, and a critical
prediction-processing/data-integrity concern remains open.

Fixing P0 items 1–3 (provider mapping, data budget, confidence semantics) and successfully executing the
BLOCKED DB gates would move this to **B. CONDITIONALLY READY**; a clean backtest demonstrating ≥85%
accuracy at the 75% threshold would be required before **A. PRODUCTION READY**.
