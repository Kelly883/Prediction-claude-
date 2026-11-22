# PredictPro — Final Independent Phase 1 Production Gate Audit

**Repository:** `Kelly883/Prediction-claude-`
**Audit type:** Independent, read-only, evidence-based
**Date:** 2026-11-22
**Auditor role:** Principal Software Architect / Backend / API Integration / DB Reliability / Security / DevOps

> This audit inspected the actual source. Claims from prior audits were treated as untrusted and verified against code. No application code, configuration, environment variables, or databases were modified. No production cron, live ingestion, or live provider requests were executed. Tests/builds were run against mocks and dummy env only.

---

## A. Executive Verdict

## **NO-GO** — not ready for production deployment.

The Phase 1 **functional core** (analysis engine, data-completeness remediation, market eligibility, odds provenance, superadmin 2FA + approval/publish flow, security) is well-implemented and fully verified: `tsc` clean, 342/342 tests pass, production build succeeds. **However**, deployment is blocked by one critical process defect and several high-severity code-level reliability defects (see §C). The advanced "provider protection / resumable ingestion / execution-budget" capabilities described in prior audits are **largely not implemented** in the actual code.

A **controlled staging deployment for functional verification** is acceptable *only after* the working tree is committed and the HIGH blockers in §E are addressed; it is **not** safe for production-representative load.

---

## B. Repository State

| Item | Value |
|---|---|
| Current branch | `main` |
| HEAD commit | `c6988d4561096abadd930571ed4eea54bb27720c` — "Fix Node crypto import in Edge Runtime auth module" |
| Main branch commit | `c6988d4…` (identical — HEAD **is** main) |
| Ahead / behind main | `0 / 0` |
| Working-tree status | **56 changed/untracked paths, all UNCOMMITTED** |
| Remediation committed? | **NO** — every remediation file exists only as an uncommitted working-tree change |
| Migrations present | `…0011, 0012, 0013, 0015` (+ untracked `0013`, `0015`). **No `0014`, no `0016`** |

**Critical implication:** production deploys build from a commit/branch. The committed `main` (`c6988d4`) does **not** contain any of the remediation (leagues mapping, http retry, math markets, eligibility, data-quality, unique constraint, Redis guard, etc.). Deploying the repository as-is would ship the **pre-remediation** code. The remediation must be committed before any deployment.

---

## C. Findings

Severity: CRITICAL / HIGH / MEDIUM / LOW. Status: PASS / PARTIAL / FAIL / NOT VERIFIED.

### C.1 Provider protection

| # | Finding | Severity | Status | Evidence | Impact / Action |
|---|---|---|---|---|---|
| P1 | Outbound provider requests all pass through a single choke point per provider | — | **PASS** | `lib/api/football-api.ts:18-37` (`request()` → `fetchWithRetry`); `lib/api/football-data.ts:12-24`. No direct `fetch()` in `lib/api/` (grep empty). | Good. Keep. |
| P2 | Retry / Retry-After / exponential backoff | — | **PASS** | `lib/analysis/http.ts:53-103` (429 honors `Retry-After` `:71-78`; 5xx/network backoff; 4xx non-retryable). | Good. |
| P3 | Circuit breaker "behaviour" | HIGH | **FAIL** | `circuitAllows`/`recordCircuitFailure`/`recordCircuitSuccess` defined at `lib/analysis/http.ts:122-151` but **never called** anywhere (grep: only definitions). `fetchWithRetry` does not consult it. | Dead code; breaker never opens. **Wire it into `fetchWithRetry`, or remove the claim.** |
| P4 | Independent API-Football & Football-Data rate limiters | HIGH | **FAIL** | No provider rate limiter exists. `lib/ratelimit.ts` is **not imported** by any provider/analysis code (only auth/admin routes). Only *reactive* retry-after backoff exists. | No proactive throttling → provider ban / 429 storms. **Implement per-provider limiters.** |
| P5 | Sliding-window Lua / Redis atomic reservation / unique sorted-set members / timestamp precision / reservation expiry / wait calc / max-wait | HIGH | **FAIL** | Not implemented. grep: `zadd`=0, `reservation`=0, `sliding`=0, `lua`=0. | Claims unsubstantiated. **Implement or retract.** |
| P6 | Provider quota snapshot / daily-vs-per-minute separation / out-of-order protection | HIGH | **FAIL** | Not implemented. grep: `quota`=0. No quota endpoint, no snapshot. | No quota visibility → silent exhaustion. **Implement.** |
| P7 | Single-flight cache (dedupe concurrent loads) | MEDIUM | **FAIL** | `lib/analysis/ingestion/cache.ts:5-29` is plain cache-aside; concurrent misses all invoke `loader()`. No lock. | Cache stampede under concurrency. **Add single-flight lock.** |
| P8 | Cache failure behaviour | — | **PASS** | `cache.ts:6-27`: read failure warns + proceeds; loader failure with cached value returns stale. | Acceptable. |
| P9 | Actual HTTP-attempt metrics | MEDIUM | **FAIL** | No attempt counters/metrics emitted. | No observability into provider call volume. |

### C.2 Ingestion reliability

| # | Finding | Severity | Status | Evidence | Impact / Action |
|---|---|---|---|---|---|
| I1 | AnalysisRun lifecycle | — | **PARTIAL** | `prisma/schema.prisma:377-392` (pending/running/completed/failed). No checkpoint columns. | Lifecycle exists; no durability. |
| I2 | Fixture batching | HIGH | **FAIL** | `lib/analysis/run.ts:109-114` loads/enriches/scores **all** fixtures in one shot; `fixtures.ts` fetches all leagues per provider call. | No batching. |
| I3 | Durable checkpoints | HIGH | **FAIL** | grep `resume`=0, `checkpoint`=0. No persisted progress. | Crash ⇒ lost work. |
| I4 | Deferred-run status | HIGH | **FAIL** | grep `deferred`=0. No deferred-run mechanism. | Claim false. |
| I5 | Resume logic | HIGH | **FAIL** | None. | Claim false. |
| I6 | Duplicate-run prevention | — | **PASS** | `run.ts:47-61` (existing running/completed check) + Redis lock `run.ts:63-96`. | Good (single-flight at run level). |
| I7 | Duplicate prediction prevention | — | **PASS** | `run.ts:135-139` upsert on `AnalysisResult.fixtureId @unique` (`schema.prisma:398`). | Good. |
| I8 | Concurrent resume protection | — | **N/A** | No resume exists. Run-level concurrency via Redis lock = PASS. | — |
| I9 | Transaction boundaries | — | **PASS** | `run.ts:120-150` persist + finalize in one `$transaction`; publish `…/publish/route.ts` transactional. | Good. |
| I10 | Recovery after process termination | HIGH | **FAIL** | On crash before the final transaction, the run row stays `running`. Next invocation returns it as `alreadyRunning` (`run.ts:83-95`) and does **no work** → **permanently stuck**, blocking all future runs until manual `force`. | **Add stale-run reaping / resume.** |
| I11 | Recovery after partial batch completion | HIGH | **N/A/FAIL** | No batching/checkpoints; partial enrichment failures are recorded but run still completes. | — |
| I12 | Deferred run never re-triggered | — | **N/A** | No deferred runs. | — |
| I13 | Provider quota exhausted behaviour | MEDIUM | **PARTIAL** | Per-league errors caught (`fixtures.ts:104-106`); if **all** providers fail, `fixtures.ts:118-120` throws → run `failed` (`run.ts:171-178`). If some leagues fail, run still `completed`. | Acceptable but no quota-aware backoff. |
| I14 | Redis unavailable behaviour | — | **PASS** | `run.ts:68-79`: production throws (fail-closed), run not created; dev continues. | Good. |
| I15 | Partial run can never be marked completed/published | HIGH | **PARTIAL** | Run marked `completed` **only** after all picks upserted in the same transaction (`run.ts:141-149`); crash ⇒ stays `running` (never `completed`). **But** `fixturesAnalyzed` is set to `fixtureResult.fixtures.length` (**fetched**, not successfully enriched — `run.ts:145`), so a run with many enrichment failures reports a misleadingly high analyzed count and is still `completed`. | Fix `fixturesAnalyzed` to count successfully scored fixtures. |

### C.3 Runtime & capacity

| # | Finding | Severity | Status | Evidence | Impact / Action |
|---|---|---|---|---|---|
| R1 | "240-second execution budget" | HIGH | **FAIL** | No 240s budget anywhere (grep `240`/`budget` = none in logic). Cron route `maxDuration = 300` (`app/api/cron/daily-analysis/route.ts:9`). | Claim false. No budget enforcement. |
| R2 | Route maxDuration | — | **PASS** | `daily-analysis/route.ts:9` = 300; `runs/[id]/rerun/route.ts:9` = 300. | OK (Vercel Pro cap). |
| R3 | Fixture concurrency | — | **PASS (fixed)** | `enrichment.ts:7` `MAX_CONCURRENCY = 10`. | Fixed, not configurable. |
| R4 | Provider timeout | — | **PASS** | `football-api.ts:10` `TIMEOUT_MS=10_000`; `football-data.ts` similar. | OK. |
| R5 | Retry limits | — | **PASS** | `http.ts:18` `DEFAULT_MAX_RETRIES=3`. | OK. |
| R6 | Actual batch size | — | **N/A** | No batching. | — |
| R7 | Runtime estimator (accounts for 2 providers, retries, limiter waits, DB) | HIGH | **FAIL** | None exists (grep `estimat` only matches an `ESTIMATED` evidence label in `shared.ts:118`). | No pre-flight cost check. |
| R8 | "48-fixture assumption" supported by evidence | HIGH | **FAIL** | `fixtures.ts:19` `FIXTURE_WINDOW_HOURS = 48` — this is a **48-hour window**, not a 48-fixture cap. **No fixture-count cap** (no `.slice(0,N)`). Fixture volume is unbounded by code (depends on real slate size). | A busy slate can be large; see R1/R10. |
| R9 | Behaviour when workload exceeds budget | HIGH | **FAIL** | No guard. If fetch+enrich exceeds 300s, Vercel kills the function mid-run → run stuck `running` (I10) → **no results, no resume**. Note: fixture fetch is **sequential per league** (`football-api.ts:47-66`); 20 leagues × (10s timeout + 3 retries) is a real worst-case blow-up. | **Add budget checks, cap fixtures, parallelize/limit fetch, and resume.** |

### C.4 Data completeness & prediction quality

| # | Finding | Status | Evidence |
|---|---|---|---|
| D1 | API-Football team-stats mapping | **PASS** | `tests/analysis-data-completeness.test.ts` green; `football-api.ts` enrichment via `safe()` wrappers `:99-113`. |
| D2 | Fixture normalisation | **PASS** | `football-api.ts:74-97` sets status/teams/ids/venue/season. |
| D3 | Season calculation | **PASS** | `leagues.ts` `apiFootballSeasonForKickoff`; `tests/analysis-leagues.test.ts` green. |
| D4 | League/provider mappings | **PASS** | `lib/analysis/leagues.ts`; `scripts/provider-coverage.mjs` → 20/20 API-Football, 16/20 Football-Data, 0 zero-source. |
| D5 | Football-Data fallback coverage | **PASS** | 16/20 with explicit unsupported list (`ECL/LIB/J1/ARG`). |
| D6 | Odds provenance | **PASS** | `football-api.ts:347` `provenance:{provider,bookmaker,timestamp}`; `shared.ts:124-143` `oddsQuoteFor`. |
| D7 | Removal of fabricated odds | **PASS** | No `?? <number>` / `|| <number>` defaults for odds (grep empty); `oddsFromValue`/`validOdds` (`shared.ts:55-57`) omit invalid odds; record returned only if `oddsCompleteness>0` (`football-api.ts:349`). |
| D8 | Market eligibility | **PASS** | `markets/eligibility.ts` wired in `engine.ts:47-69`; `filterPicks` requires `proceed` eligibility. FIRST_HALF/CARDS/PLAYER_SCORER disabled; CORNERS restricted; ASIAN_HANDICAP requires line. |
| D9 | Fixture status filtering | **PASS** | `fixture-status.ts:49-51` `isPlayableFixture = status==='scheduled'`; applied `fixtures.ts:93`. |
| D10 | Data-quality classification | **PASS** | `shared.ts:97-110` PRIMARY_COMPLETE/PARTIAL/FALLBACK_PARTIAL/INSUFFICIENT + confidence caps (INSUFFICIENT→74 < 75 threshold). |
| D11 | Asian Handicap line validation | **PASS** | `asianHandicap.ts:36-43` → `Unavailable` if no real line; eligibility requires `handicapLine` (`eligibility.ts:17,56-58`). |
| D12 | Player scorer market restrictions | **PASS** | `eligibility.ts:41-47` PLAYER_SCORER `enabled:false`. |
| D13 | Missing enrichment fields | **PASS** | `enrichment.ts:44-52` `safe()` per field; `eligibility.ts:89-96` missingFields. |
| D14 | Model-score terminology | **PASS** | `shared.ts:165` `confidenceLabel:'HEURISTIC_MODEL_SCORE'`; `types/analysis.ts` documents non-calibrated. |

### C.5 Database & security

| # | Finding | Severity | Status | Evidence |
|---|---|---|---|---|
| S1 | Prisma schema valid | — | **PASS** | `prisma validate` OK. |
| S2 | Migration sequence incl. "0016" | MEDIUM | **FAIL** | `0016` **does not exist** (highest `0015`); also no `0014` (harmless gap). Claim false. `0013` (unique fixtureId), `0015` (nullable bestOdds) present. |
| S3 | Unique constraints / partial indexes | — | **PASS** | `AnalysisResult.fixtureId @unique` (`schema.prisma:398`), `predictionPostId @unique` (`:414`), `AnalysisConfig.key @unique`, `LeagueConfig.leagueCode @unique`. (Full unique, not partial — acceptable.) |
| S4 | Transaction consistency | — | **PASS** | `run.ts:120-150`; publish route transactional. |
| S5 | Superadmin authorization | — | **PASS** | `lib/analysis/api-auth.ts:5-9` → `requireSuperAdmin` (`rbac.ts:68`). |
| S6 | Two-factor enforcement | — | **PASS** | `rbac.ts:77` rejects if `!twoFactorEnabled` for superadmin. |
| S7 | Cron secret validation | — | **PASS** | `daily-analysis/route.ts:11-15` `timingSafeStringEqual`, fail-closed if `CRON_SECRET` unset. |
| S8 | Provider-status endpoint protection | — | **N/A** | No provider-status endpoint exists (grep empty). |
| S9 | Secret leakage in logs/responses | — | **PASS** | `run.ts` logs ids/counts only; `http.ts`/provider errors don't include keys. |
| S10 | Prediction approval & publication | — | **PASS** | `results/[id]/route.ts` PATCH (approve/dismiss; published blocked 409); `…/publish/route.ts` (only `approved`→publish, 409 otherwise; transactional). |
| S11 | Audit logging | — | **PASS** | `writeAudit` on config/approve/dismiss/publish/rerun/delete/run. |

### C.6 Production operations

| # | Finding | Status | Evidence |
|---|---|---|---|
| O1 | Upstash Redis (code requires in prod) | **PASS (code)** | `lib/redis.ts` lazy-throws in production if unconfigured. Config must be set. |
| O2 | PostgreSQL | **PASS (code)** | `env.ts:5` requires `DATABASE_URL`. |
| O3 | Vercel execution duration | **PASS (code)** | `maxDuration=300` on cron + rerun. |
| O4 | API-Football subscription | **NOT VERIFIED** | No live key/entitlement verified (read-only audit). |
| O5 | Football-Data.org subscription | **NOT VERIFIED** | Same. |
| O6 | Cron scheduling | **PARTIAL** | `vercel.json` declares daily-analysis `0 6 * * *`; actual Vercel dashboard config NOT verified. |
| O7 | Quota refresh before analysis | **FAIL** | No quota mechanism (P6). |
| O8 | CRON_SECRET | **PASS (code)** | `env.ts:7` min 32. |
| O9 | Error monitoring | **FAIL** | No Sentry/Datadog/etc. (grep empty). |
| O10 | Alerting | **FAIL** | None. |
| O11 | Backup & recovery | **PARTIAL** | `docs/backup-restore.md` exists (documentation only; not verified as configured/tested). |

---

## D. Verification Results (exact commands)

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** — 0 errors |
| `DATABASE_URL=… DIRECT_URL=… npx prisma validate` | **PASS** — "schema is valid" |
| `npx vitest run tests/analysis-*.test.ts` (7 files) | **PASS** — 74/74 |
| `npx vitest run` (full suite) | **PASS** — **54 files, 342 tests, 0 failures** (234s; only pre-existing `vi.hoisted` warnings in `payments.test.ts`) |
| `npx next build` (dummy env) | **PASS** — compiled, TS clean, **98/98** static pages, all routes emitted |
| `npm run lint` (`eslint .`) | **PASS** — 0 errors (78 non-blocking unused-var warnings) |
| `npx prisma migrate diff --from-migrations … --to-schema-datamodel …` | **SKIPPED/BLOCKED** — requires `--shadow-database-url` (no test DB in sandbox) |
| Live provider ingestion / migration apply | **NOT RUN** — prohibited by audit constraints; no live DB |

Migration↔schema consistency verified **by inspection**: `0012` creates the analysis tables, `0013` adds `AnalysisResult.fixtureId` unique, `0015` makes `bestOdds` nullable — all match `schema.prisma`. Live migration apply is **NOT VERIFIED**.

---

## E. Outstanding Blockers

**Code defects (must fix before production):**
1. **All remediation is uncommitted** — commit to a branch and deploy from that commit (§B). *(CRITICAL, process)*
2. **No resumable ingestion / checkpoints / deferred runs / batching** — crashed/timed-out runs stay `running` forever and block future runs (§C.2 I2-I5, I10). *(HIGH)*
3. **No execution budget or fixture cap** — real slates can exceed 300s → killed mid-run, no resume; fixture fetch is sequential per league (§C.3 R1, R7-R9). *(HIGH)*
4. **No provider rate limiting / quota management** — ban & silent-exhaustion risk (§C.1 P4-P6). *(HIGH)*
5. **Circuit breaker is dead code** (§C.1 P3). *(MEDIUM)*
6. **`fixturesAnalyzed` overcounts** (fetched, not analyzed) (§C.2 I15). *(MEDIUM)*
7. **No monitoring/alerting** (§C.6 O9-O10). *(MEDIUM)*
8. **"Migration 0016" does not exist** (§C.5 S2) — correct the claim. *(LOW)*

**Infrastructure requirements:** Upstash Redis, PostgreSQL (SSL), Vercel Pro (300s), `CRON_SECRET`, provider API keys/subscriptions, Vercel cron registration.

**Provider entitlement:** API-Football & Football-Data.org plan limits **NOT VERIFIED** (no live keys used).

**Live verification (not performed):** real provider ingestion, live migration apply against staging Postgres, end-to-end cron execution, load test at realistic slate size.

---

## F. Final Deployment Checklist (ordered)

1. **Commit** the entire working tree to a dedicated branch; open PR; **do not deploy `c6988d4`** (pre-remediation).
2. Fix **I10** (stale-`running` reaper) and **I15** (`fixturesAnalyzed` = scored count).
3. Add **execution budget + fixture cap** (R1/R8) and **batching** (I2); verify worst-case fetch+enrich < 300s.
4. Implement **per-provider rate limiters + quota tracking** (P4-P6) or explicitly retract the claim and accept ban risk.
5. **Wire the circuit breaker** into `fetchWithRetry` (P3) or remove it.
6. Add **monitoring/alerting** (O9-O10) and verify `docs/backup-restore.md` procedure (O11).
7. Provision & verify **Upstash Redis, PostgreSQL (SSL), Vercel Pro, CRON_SECRET, provider subscriptions** (O1-O5).
8. Register/verify **Vercel cron** for `/api/cron/daily-analysis` (O6).
9. Apply migrations **0013 + 0015** to staging Postgres; run `prisma migrate status` (S2).
10. Run **live ingestion** against staging with real provider keys; confirm no 429 storms, correct status filtering, odds provenance, and that a forced timeout leaves a recoverable run.
11. Re-run this gate audit on the committed branch with live evidence.

---

## G. Final Conclusion

PredictPro Phase 1 has a **solid, well-tested functional core** — the analysis engine, data-completeness remediation, market-eligibility gating, odds provenance, and the superadmin 2FA/approval/publish security model are correctly implemented and fully verified (tsc clean, 342/342 tests, production build green). **It is NOT ready for production deployment** because (a) the remediation is entirely uncommitted, (b) ingestion lacks resume/checkpoint/budget and will strand runs on any crash or large slate, and (c) the advertised provider-protection layer (rate limiters, quota, single-flight, circuit breaker) is largely absent.

**Controlled staging deployment:** permitted **only after** committing the work and closing the HIGH blockers in §E, and strictly for functional verification — not for production-representative load — until live provider ingestion and realistic-slate capacity are proven.