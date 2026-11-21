# PredictPro — Final Independent Phase 1 Production Readiness Verification

- **Audit type:** Independent, evidence-based production readiness verification
- **Date:** 2026-11-22
- **Auditor roles:** Senior Software Architect / Principal QA / DevSecOps / DB Reliability Engineer / Independent Production Auditor
- **Reference documents (treated as historical claims, NOT proof):**
  - `docs/PHASE_1_PRODUCTION_READINESS_AUDIT.md` (incl. Revision 2 addendum)
  - `docs/PROVIDER_COVERAGE_REPORT.md`
- **Verification scope:** The repository as it exists on the audited revision below.
- **Code modification during audit:** None. No commit, push, deploy, or production operation was performed.

> Compliance note: this exercise inspected the repository and executed commands only. No application code was changed. `docs/FINAL_PHASE_1_INDEPENDENT_VERIFICATION.md` is the only file produced.

---

## §2 — Baseline

| Item | Expected | Actual | Status |
|---|---|---|---|
| Current branch | Remediation branch or authorized release branch | `trae/agent-4phDPY` | PASS |
| Working tree | Preserve existing changes | Clean (`git status --porcelain` empty); no user modifications overwritten | PASS |
| Latest commit (local) | Remediation commit present | `4ba9e8e fix(phase1): remediate P0/P1 production-readiness defects` | PASS |
| Remote `main` | Contains remediations merged | `287467a` (PR #79 merged); local tree byte-identical to `main` (`git diff --stat 287467a HEAD` empty) | PASS |
| Provider mappings | Present | `lib/api/provider-mapping.json` (20 entries) + `provider-mapping.ts` helpers | PASS |
| Retry implementation | Present | `lib/api/retry.ts` (bounded retry, `Retry-After`, quota/auth classification) | PASS |
| Market corrections | Present | `doubleChance.ts`, `correctScore.ts`, `asianHandicap.ts` corrected; `lib/analysis/utils/poisson.ts` Poisson PMF | PASS |
| Database integrity fixes | Present | Unique `AnalysisResult(runId,fixtureId)` (migration 0013); partial unique `AnalysisRun(runDate) WHERE status='running'` (migration 0014); atomic `$transaction` finalization | PASS |
| Redis fail-closed behavior | Present | `lib/redis.ts` throws in production when Upstash vars absent; in-memory only in dev/test | PASS |
| Circuit breaker | Present | `lib/api/circuit-breaker.ts` distributed via Redis | PASS |
| Audit improvements | Present | `lib/audit.ts` redaction; config audit before/after; cron recorded as `system:cron` | PASS |
| Test coverage configuration | Present | `@vitest/coverage-v8` with 90% thresholds on analysis modules | PASS |

**Baseline conclusion:** the working tree does contain the Revision 2 remediation set. This was established by inspection, not by trusting the audit document.

---

## §A — Executive decision

### **B — CONDITIONALLY READY**

The Phase 1 implementation is **code-complete and internally well-verified**. Every automated suite the project defines passes, the database integrity model is sound and physically verified on a real Postgres, the 10-market engine is mathematically defensible, and superadmin authorization is enforced server-side on every analysis route.

However, readiness **cannot be unconditionally confirmed** because:

1. The **single most important production question — whether the configured provider subscriptions can genuinely serve the advertised 20-league service — is answered NO for the documented free tiers and is otherwise BLOCKED** (no live credentials). The project's own `PROVIDER_COVERAGE_REPORT.md` states the free tiers cannot support 20 leagues.
2. **Live provider, live Redis, and production-database integration are all BLOCKED** — no real credentials or infrastructure are available in this environment.
3. **Vercel plan entitlement for the 300s cron duration is BLOCKED** (cannot inspect the deployed plan).

No regression or critical defect was found in the remediated code. The blocker is *external provisioning and entitlement*, not code correctness.

---

## §B — Independent readiness score

Methodology: PASS = 1.0, PARTIAL = 0.5, FAIL = 0.0, BLOCKED = 0.0.

| # | Category | Score | Basis |
|---|---|---:|---|
| 1 | Database foundation | 1.0 | 15 migrations replay cleanly on a real PG; indexes verified in `pg_indexes`; schema validates |
| 2 | Data providers | 0.5 | Mappings/retry/classification verified by code + unit tests; **live entitlement & 20-league capacity BLOCKED** |
| 3 | Fixture ingestion | 0.5 | 48h window, provider fallback, quota/auth surfaced (unit-tested); live provider path BLOCKED |
| 4 | Data enrichment | 0.5 | Adapters tested; live enrichment BLOCKED |
| 5 | 10-market engine | 1.0 | All 10 markets pass independent tests; 100% line coverage; Poisson/Double Chance/AH corrections verified |
| 6 | Confidence threshold | 1.0 | Inclusive `>=` boundary verified; `modelScore` compat; described as model score; no probability claim |
| 7 | Result storage | 1.0 | Zod boundary, unique indexes, atomic finalization, real-Postgres tests pass |
| 8 | Superadmin authorization | 1.0 | Every analysis route calls `requireAnalysisAdmin` (same-origin + CSRF + superadmin 2FA); role tests pass |
| 9 | Approval & publishing | 1.0 | Approved-only, 409 duplicate block, transactional, DB-level `predictionPostId` unique |
| 10 | Audit logging | 1.0 | Redaction, before/after values, cron system actor |
| 11 | Automated tests | 1.0 | 390 passed / 4 skipped (real-PG skipped by default, run separately and passed); thresholds met |
| 12 | Security | 0.5 | No high/critical; several low/informational findings; production security config unverifiable |
| 13 | Deployment & cron | 0.5 | 06:00 UTC confirmed, timing-safe auth; **Vercel plan & prod Redis BLOCKED** |
| 14 | Performance | 0.0 | No production load evidence; BLOCKED |

**Total = 11.5 / 14 = 82.1%**

Historical Revision-2 result (98.92% etc.) describes *test coverage of the analysis modules*, not 14-category production readiness. It is not directly comparable and was not used as an acceptance input.

---

## §C — Verified evidence (commands actually executed)

All commands were executed on this machine against the current tree. Environment: Node 22, isolated local PostgreSQL 16 (`predictpro_test`, `postgres`/local-only credentials). No real secrets, provider keys, or production endpoints were used.

| # | Command | Exit | Result | Environment / mocks |
|---|---|---|---|---|
| 1 | `git rev-parse --abbrev-ref HEAD` / `git status --porcelain` / `git log` / `git ls-remote origin` | 0 | Branch `trae/agent-4phDPY`, clean tree, HEAD `4ba9e8e`, remote main `287467a` | local git |
| 2 | `npm run lint` (`eslint . --ext .ts,.tsx`) | 0 | Clean | static |
| 3 | `npx tsc --noEmit` | 0 | Clean | static |
| 4 | `npm run test:unit` | 0 | 7 files, **89 passed** | unit (mocked providers) |
| 5 | `npm run test:integration` | 0 | 3 files, **23 passed** | integration (mocked DB/HTTP) |
| 6 | `npm run test:auth` | 0 | 2 files, **11 passed** | authz (mocked) |
| 7 | `npx vitest run --coverage` | 0 | 58 files passed, 1 skipped; **390 passed / 4 skipped**; coverage 98.92% stmts / 96.07% branch / 100% funcs / 100% lines | full suite; DB suite auto-skipped |
| 8 | `npx prisma validate` (with local env) | 0 | `The schema at prisma/schema.prisma is valid` | static |
| 9 | `npx prisma generate` | 0 | Client generated | static |
| 10 | `npx prisma migrate status` (pre-apply) | 1 | 15 migrations found, none applied (fresh DB) — expected | isolated DB |
| 11 | `npx prisma migrate deploy` (fresh replay) | 0 | **All 15 migrations applied** (`0001_init` … `20250819_add_superadmin_and_permissions`) | real PG, isolated |
| 12 | `npx prisma migrate status` (post-apply) | 0 | `Database schema is up to date!` | real PG, isolated |
| 13 | `npm run test:db` (`TEST_DATABASE_URL` set) | 0 | **4 passed** against real Postgres | **real infrastructure** |
| 14 | `psql` index inspection | 0 | `AnalysisResult_runId_fixtureId_key` (unique) and `AnalysisRun_running_runDate_key` (`WHERE status='running'`) confirmed present | real PG, isolated |
| 15 | `npm run build` (dummy build-time env) | 0 | Production build succeeded; middleware 64.2 kB; all routes compiled | build-only (no live infra) |
| 16 | `npm audit --registry=https://registry.npmjs.org` | 0 | `found 0 vulnerabilities` | registry |

**Skipped tests:** only the 4 real-Postgres tests in `tests/analysis-db.test.ts` are skipped in the default (coverage) run because `TEST_DATABASE_URL` is unset. They were executed separately (row 13) and pass. No other tests were skipped.

**Not executed (environment unavailable / out of safe scope):** `npm run test:e2e` (Playwright, requires a running app + browser), live provider probes, live Upstash Redis, live Vercel cron trigger. See §E.

---

## §3 — Football data providers

### Verified by inspection + unit tests

- **20 internal league mappings** present in `lib/api/provider-mapping.json`.
- **API-Football numeric IDs** — explicit numeric ids for all 20 (PL 39, PD 140, BL1 78, SA 135, FL1 61, PPL 94, ERE 88, CL 2, EL 3, ECL 848, BL2 79, PD2 141, SA2 136, FL2 62, ELC 40, MLS 253, LIB 262, J1 98, ARG 128, BRA 71).
- **`ERE` → `DED`** ✅ (line 8). **`BRA` → `BSA`** ✅ (line 21).
- **Unsupported competitions skipped, not mis-queried** — `partitionByProviderSupport` + `fetchFootballDataFixtures` skip leagues with no provider code; `fetchApiFootballFixtures` skips unmapped leagues (verified in `lib/api/football-data.ts`, `lib/api/football-api.ts`, and adapter tests).
- **Quota surfaced as failure** — `ProviderQuotaExhaustedError` rethrown, never converted to an empty success (`lib/analysis/ingestion/fixtures.ts` lines 52–56).
- **429 respects `Retry-After`** — `parseRetryAfter` (seconds or HTTP-date) + `withBoundedRetry` honouring it (`lib/api/retry.ts`).
- **Retry bounded** — attempts clamped to [0,5]; base/max delays clamped; auth (`ProviderAuthError`) and quota errors are **non-recoverable** and not retried.
- **Failures cannot silently become empty data** — only recoverable errors fall through; quota/auth abort the run.

### Critical 20-league capacity assessment

**Evidence (`docs/PROVIDER_COVERAGE_REPORT.md`, generated from the authoritative map):**

- API-Football **Free** = **100 requests/day**, season-entitlement restricted.
- Football-Data.org **Free (Tier One)** = 10 requests/min, **10 of 20** product leagues only (no EL, ECL, BL2, PD2, SA2, FL2, MLS, LIB, J1, ARG).
- The report's own conclusion: *"the free tiers cannot support verified 20-league coverage."* Enrichment issues multiple calls per fixture, so a 20-league daily run exhausts a 100 req/day budget.

**Conclusion — can the currently configured provider subscriptions genuinely support the advertised 20-league service?**

> **No — not on the documented free tiers (FAIL-by-evidence). Live confirmation of the actual provisioned plan is BLOCKED (no credentials).** A paid API-Football tier (or a combination of paid tiers) is required. This is the single largest production blocker. It cannot be answered "yes" without evidence, and no such evidence exists.

---

## §4 — 10-market analysis engine

All ten markets implemented under `lib/analysis/markets/`. Independent review + the project's market tests + 100% line coverage support the following.

**Double Chance** (`doubleChance.ts`) — PASS
- Derives from the underlying 1X2 model: consumes `model.homeOrDraw / awayOrDraw / homeOrAway`.
- Evaluates Home/Draw, Away/Draw, Home/Away; selects the **highest-probability eligible** outcome.

**Correct Score** (`correctScore.ts` + `utils/poisson.ts`) — PASS
- Uses a genuine Poisson PMF (`poissonPmf`) and a normalized scoreline grid (`buildScorelineModel`).
- Selects the most probable scoreline (`mostLikelyScoreline`).
- Defensible fallback when stats are missing (neutral peak `CORRECT_SCORE_NEUTRAL_PEAK = 0.1`; reduced evidence weight when `source === 'league'`).

**Asian Handicap** (`asianHandicap.ts`) — PASS
- Uses the **actual captured line** (`enrichment.odds?.asianHandicap?.line`).
- `settleAsianHandicap` computes full win / half win / push / half loss / full loss with **quarter-line splitting**.
- Does **not** silently substitute a hard-coded −0.5: without a real captured line and edge > `MIN_HANDICAP_EDGE = 0.02` it declines the pick ("No handicap").

**Remaining markets** (`matchResult`, `btts`, `overUnder`, `firstHalfResult`, `totalCorners`, `totalCards`, `playerScorer`, `shared`) — PASS
- Deterministic outputs, input validation, graceful missing-data handling, no fabricated predictions. Behavioral branches exercised by `analysis-markets.test.ts` / `analysis-branches.test.ts`.

---

## §5 — Model score and threshold

- Described as a **model score, not a calibrated probability** — `lib/analysis/utils/confidence.ts` docstring, and seeded config description: *"Minimum model score (0-100) for a pick to be generated"* (`configDescriptionForSeed('confidence_threshold')`, asserted in `analysis-utils.test.ts`).
- **`modelScore` compatibility** — `GET /api/superadmin/analysis/runs/[id]` returns `modelScore` mirroring stored `confidence` (non-probabilistic name) while retaining `confidence` for compatibility.
- **Threshold 75 enforced consistently** — default in `DEFAULT_ANALYSIS_SETTINGS`; `filterPicks(outcomes, threshold) => best.confidence >= threshold` (inclusive).
- **Boundary** — `analysis-utils.test.ts` ("applies the pick threshold inclusively at the boundary") verifies `exact` → included, `exact + 0.01` → excluded, `exact − 0.01` → included. Semantics are equivalent to (and more general than) the 74.99 / 75 / 75.01 cases; literal values are not hard-coded.
- **No "75% chance" claim found** in API responses, config copy, or labels.
- **Backtest / calibration:** none exists in the repository. **Accuracy claims therefore remain unverified.** No accuracy percentage is asserted anywhere in this report.

---

## §6 — Database integrity

Verified against an **isolated local PostgreSQL 16** (`predictpro_test`). Production DB was never touched.

1. **`(runId, fixtureId)` uniqueness** — `@@unique([runId, fixtureId])` (schema) + migration `0013`; confirmed live in `pg_indexes`; enforced by `skipDuplicates`.
2. **Partial unique index** — `AnalysisRun_running_runDate_key` `WHERE status='running'` (migration `0014`); confirmed live.
3. **P2002 handling** — `lib/analysis/run.ts` catches `PrismaClientKnownRequestError` code `P2002` on run create and reports the in-flight run.
4. **Atomic run finalization** — `prisma.$transaction(createMany(skipDuplicates) + analysisRun.update)` commits results and completion together.
5. **`createMany(skipDuplicates)`** — implemented and exercised in `analysis-db.test.ts`.
6. **Zod validation** — `lib/analysis/persistence.ts` validates persisted score/odds/confidence/factors before writing.
7. **Seed idempotency** — `prisma/seed.mjs` uses upserts; config seeding is gated on superadmin existence.
8. **Migration/schema consistency** — `prisma validate` passes; `migrate status` = up to date after apply.
9. **Ordering & fresh replay** — all **15** migrations applied in order on a fresh DB (row 11), including the two new guards.

**Result:** PASS for local/isolated DB. **Production DB connectivity remains BLOCKED** (no production credentials) — local success is not proof of production connectivity.

---

## §7 — Distributed reliability

- **Production fails closed** — `lib/redis.ts` throws when `UPSTASH_REDIS_REST_URL/TOKEN` are absent and `NODE_ENV==='production'`. Lazy `Proxy` singleton keeps `next build` working without runtime Redis.
- **In-memory fallback limited to dev/test** — only reachable when `NODE_ENV !== 'production'`.
- **Atomic lock acquisition** — `redis.set(lockKey,'1',{nx:true,ex:600})`; only `'OK'` counts as holding the lock.
- **Safe release** — released in `finally`; release failures logged, not fatal.
- **Multi-instance exclusion** — distributed NX lock + **database partial unique index as a second guard**; a lost lock cannot produce two concurrent runs.
- **Distributed circuit breaker** — `lib/api/circuit-breaker.ts` stores state in Redis; only recoverable failures trip it; fails open on Redis error.
- **Quota/auth not hidden** — non-recoverable provider errors abort rather than degrade.
- **Retries do not duplicate** — `skipDuplicates` + `(runId,fixtureId)` unique index make persistence retry-safe.

*Operational note (informational):* lock TTL (600s) exceeds cron `maxDuration` (300s). If a run crashes without releasing, the lock clears within 10 min; a run left in `running` would report `alreadyRunning` until then. No auto-reaper for stale `running` rows was found.

**Result:** PASS by code + unit tests; **live Redis behavior BLOCKED**.

---

## §8 — Superadmin security

- **Every** `app/api/superadmin/analysis/**` route calls `requireAnalysisAdmin(req[, true])` = `requireSameOrigin` + (`requireCsrf` when mutating) + `requireSuperAdmin`. Verified across all 6 route files (`results`, `results/[id]`, `results/[id]/publish`, `config`, `runs`, `runs/[id]`, `runs/[id]/rerun`).
- **`requireSuperAdmin`** enforces superadmin role **and** 2FA; `requireUser` distinguishes 401 vs 403 (deactivated); `errorResponse` maps `ApiError`.
- **Role matrix** exercised by `analysis-authz.test.ts` + `analysis-authz-roles.test.ts` (11 tests) across unauthenticated / attendee / organizer / admin / superadmin.
- **CSRF** — double-submit token compared with `crypto.timingSafeEqual`; **same-origin** enforced via Origin/Host comparison.
- **No privilege escalation** — authorization derived from the verified token, not request bodies; mutations validated by Zod.
- **No secret leakage** — responses are the Prisma records (no env/booking secrets).

**Findings (§12 cross-reference):** middleware has **no `/superadmin` branch** (UX-only; server-side authorization still enforced — see F-03); **no rate limiting** on analysis routes (low — superadmin-only surface, see F-04); `requireSameOrigin` allows requests with no `Origin` header (also allowlisted by CSRF; informational, see F-05); `validateCsrf` would throw on length-mismatched tokens rather than returning `false` (still rejects; low robustness, see F-06).

**Result:** PASS (authorization is enforced server-side and independently tested).

---

## §9 — Approval, publishing and audit trail

- **Approval cannot publish invalid/unapproved picks** — publish requires `status === 'approved'` (else 409).
- **Duplicate publishing prevented** — rejects when `predictionPostId` set or `status==='published'` (409); additionally `AnalysisResult.predictionPostId` is `@unique`, so a concurrent race fails the second transaction at the DB level.
- **Publishing is transactional** — `predictionPost.create` + `analysisResult.update` in one `$transaction`.
- **Booking codes validated** — `PublishSchema` (`bookingCode` 1–64 chars, etc.); **not written to audit** (metadata carries only `analysisResultId`, `visibility`, `bestMarket`).
- **Config audit before/after** — `config/route.ts` pre-reads previous values and writes `{ key, previousValue, newValue }`.
- **Cron recorded as system actor** — `actorType:'system'`, `actor:'system:cron'`, `trigger:'cron'` + run metrics.
- **Redaction** — `lib/audit.ts` `REDACTED_KEYS` + recursive redact; `writeAudit` never throws into the caller.

**Result:** PASS.

---

## §10 — Cron and deployment

- **Schedule 06:00 UTC** — `vercel.json` `/api/cron/daily-analysis` = `0 6 * * *` ✅ (also `/renew` 0 2, `/cleanup` 0 3).
- **Fixture window = next 48h** — `FIXTURE_WINDOW_HOURS = 48`.
- **Cron auth secure** — timing-safe comparison of the `Bearer` token against `CRON_SECRET`.
- **Runtime** — `export const maxDuration = 300` on the cron route.
- **Env documented** — `.env.example` documents `DATABASE_URL` (sslmode=require), `DIRECT_URL`, `CRON_SECRET` (≥32 chars), JWT secrets, Upstash vars, provider keys.
- **Observability** — structured JSON logger (`lib/logger.ts`); cron writes a summary audit row.

**BLOCKED:** Vercel plan entitlement for 300s (Hobby caps at 60s) cannot be inspected; production Redis/DB connectivity cannot be inspected. **Both BLOCKED.**

---

## §11 — Complete verification suite

See §C for the full command table. Summary vs the Revision-2 historical claims:

| Metric | Rev 2 (historical) | Re-run (actual) | Match |
|---|---|---|---|
| Unit tests | 89 | 89 passed | ✅ |
| Integration tests | 23 | 23 passed | ✅ |
| Auth tests | 11 | 11 passed | ✅ |
| Coverage suite | 390 / 4 skipped | 390 passed / 4 skipped | ✅ |
| Statements | 98.92% | 98.92% | ✅ |
| Branches | 96.07% | 96.07% | ✅ |
| Functions | 100% | 100% | ✅ |
| Lines | 100% | 100% | ✅ |
| Real-Postgres DB tests | 4 | 4 passed | ✅ |
| Migrations (fresh replay) | 15 | 15 applied | ✅ |
| Production build | success | success | ✅ |
| `npm audit` | 0 vulns | 0 vulnerabilities | ✅ |

All historical claims were **independently reproduced** — but note they describe *test coverage*, which is not production readiness.

---

## §12 — Remaining security & operational findings

| ID | Finding | Severity | Actual production impact |
|---|---|---|---|
| F-01 | JSON-LD uses `JSON.stringify` into `dangerouslySetInnerHTML` **without escaping `<`, `>`, `&`** (`components/Breadcrumbs.tsx`, `app/page.tsx`, `app/how-it-works/page.tsx`, league/prediction pages, `not-found.tsx`). | **Low** | Current values are **static/derived constants** (`ORG_JSON_LD`, `WEBSITE_JSON_LD`, hard-coded breadcrumb labels) — no user input flows in today, so no exploitable XSS now. Latent risk if dynamic data is ever injected. Recommend escaping `<`/`>`/`&` to `\u003c`/`\u003e`/`\u0026`. |
| F-02 | `scripts/security-scan.mjs` only `console.log`s; it **never exits non-zero**, so the CI "Static security scan" step **cannot fail the build** (even though it flags `dangerouslySetInnerHTML` as HIGH). | **Low / Informational** | The scan is advisory only — it provides no gate. `npm audit --audit-level=critical` is the only dependency gate that can fail CI. |
| F-03 | `middleware.ts` matcher includes `/superadmin/setup/:path*` and `/superadmin/analysis/:path*`, but the middleware body has **no `/superadmin` branch** — those paths fall through to `NextResponse.next()`. | **Informational** | **Not a security hole:** the actual boundary is the `requireAnalysisAdmin` call in every superadmin API route (verified §8). Only the edge UX-redirect is missing. |
| F-04 | **No rate limiting** on `/api/superadmin/analysis/**` routes. | **Low** | Superadmin-only surface behind 2FA; limited abuse potential. Rate limiting exists only on auth routes. |
| F-05 | `requireSameOrigin` returns early when `Origin`/`Host` are absent. | **Informational** | Non-browser clients bypass the origin check, but CSRF is independently enforced by the double-submit token; browsers always send `Origin` on cross-origin requests. |
| F-06 | `validateCsrf` calls `crypto.timingSafeEqual` on possibly different-length buffers (throws instead of returning `false`). | **Low** | Still rejects the request; worst case an unhandled error where a clean 403 is expected. |
| F-07 | **No error-monitoring integration** (no Sentry/Datadog/etc.; only the local JSON logger). | **Medium (operational)** | Failures are logged but not aggregated/alerted. Observability is best-effort. |
| F-08 | Vercel **300s cron duration** vs plan entitlement unverifiable. | **Medium (deployment)** | If deployed on Hobby (60s cap), the daily run would time out. |
| F-09 | **No league enable/disable or per-league weight API.** `LeagueConfig` is only seeded; there is no endpoint to toggle leagues or edit weights. | **Low (Phase 1 scope)** | Matches "Phase 1 foundation" scope; noted for Phase 2. |
| F-10 | **`LeagueConfig.marketWeights` is stored but never read.** `getEnabledLeagues()` selects only `{id, leagueName, leagueCode, isEnabled, priority}`; `engine.ts` uses **global** `settings.marketWeights` (from `AnalysisConfig`). | **Low** | Per-league weight overrides silently have no effect. Global weights *are* consumed. Document or wire it up. |

None of these is a critical or high-severity defect. No issue was exaggerated.

---

## §13 — Production readiness scoring

See §B. **Total = 11.5 / 14 = 82.1%.** PASS awarded only where independently executed or fully inspectable-and-tested; BLOCKED items scored 0.0.

---

## §D — Findings (consolidated)

| ID | Severity | Description | Evidence | Affected files | Production impact | Recommended resolution |
|---|---|---|---|---|---|---|
| F-01 | Low | Unescaped JSON-LD via `dangerouslySetInnerHTML` | `grep dangerouslySetInnerHTML` (27 hits) all `JSON.stringify(...)` | `components/Breadcrumbs.tsx`, `app/page.tsx`, `app/how-it-works/page.tsx`, league/prediction pages, `app/not-found.tsx` | None today (static data); latent XSS | Escape `<`,`>`,`&` in a shared serializer |
| F-02 | Low/Info | Static scan cannot fail CI | `scripts/security-scan.mjs` never returns non-zero | `scripts/security-scan.mjs`, `.github/workflows/ci.yml` | Advisory only | Exit non-zero on HIGH, or document as advisory |
| F-03 | Info | No `/superadmin` middleware branch | `middleware.ts` body vs matcher | `middleware.ts` | None (server-side authz holds) | Optional: add UX redirect |
| F-04 | Low | No rate limit on analysis routes | no `checkRateLimit` in superadmin routes | `app/api/superadmin/analysis/**` | Limited (2FA surface) | Add throttling if desired |
| F-05 | Info | Same-origin allows missing Origin | `lib/csrf.ts` `requireSameOrigin` | `lib/csrf.ts` | None (CSRF still enforced) | Optional hardening |
| F-06 | Low | `timingSafeEqual` length mismatch throws | `lib/csrf.ts` `validateCsrf` | `lib/csrf.ts` | Clean 403 becomes error | Length-check before compare |
| F-07 | Medium | No error-monitoring integration | `grep sentry/datadog/...` → none | repo-wide | Failures not alerted | Add a monitoring SDK |
| F-08 | Medium | Vercel 300s entitlement unverified | `maxDuration=300`; plan not inspectable | `app/api/cron/daily-analysis/route.ts`, Vercel dashboard | Possible cron timeout | Confirm plan supports 300s |
| F-09 | Low | No league enable/disable or weight API | route glob shows none | `app/api/superadmin/analysis/**` | Phase 2 scope | Defer |
| F-10 | Low | Per-league `marketWeights` unused | `getEnabledLeagues` select; `engine.ts` weights | `lib/analysis/ingestion/fixtures.ts`, `lib/analysis/engine.ts` | Overrides silently ignored | Wire up or document |
| F-11 | **High (blocker)** | Documented free tiers cannot serve 20 leagues | `docs/PROVIDER_COVERAGE_REPORT.md` | providers / billing | Advertised 20-league service fails on free tier | Provision paid provider tier(s) |

---

## §E — External dependencies (required but unavailable here)

| Dependency | Needed for | Status |
|---|---|---|
| Paid API-Football tier (or combination) meeting 20-league + enrichment budget | §3 capacity, live ingestion | **BLOCKED** — no key/billing |
| Live provider API keys (`API_FOOTBALL_KEY`, `FOOTBALL_DATA_API_KEY`) | Live provider probes | **BLOCKED** |
| Production database (`DATABASE_URL`/`DIRECT_URL`) | Production connectivity/pooling | **BLOCKED** |
| Production Redis (Upstash URL/token) | Live lock/breaker behavior | **BLOCKED** |
| Vercel plan confirmation | §10 300s entitlement | **BLOCKED** |
| Error-monitoring service | F-07 | **BLOCKED/absent** |
| Historical match data | Backtest/calibration accuracy | **Absent** — no accuracy claim can be made |

---

## §F — Release blockers vs optional improvements vs Phase 2

**Genuine release blockers (must resolve before serving real users):**
1. **F-11** — Provision and *verify* paid provider entitlement that genuinely covers the advertised 20 leagues + enrichment budget (currently fails on free tier; production confirmation BLOCKED).
2. **F-08** — Confirm the Vercel plan supports a 300s cron; otherwise reduce runtime or raise the plan.
3. **Production infra verification** — live DB connectivity/pooling, live Redis, and a real (authorized) cron execution must be confirmed in the target environment.

**Optional improvements (not blocking):**
- F-01 (escape JSON-LD), F-02 (make scan a gate), F-04 (rate limit), F-06 (CSRF length guard), F-05/F-03 (hardening/UX), F-07 (error monitoring), F-10 (wire or document per-league weights).

**Deferred to Phase 2:**
- F-09 (league enable/disable + weight APIs).
- Backtest/calibration subsystem (and therefore any accuracy claim).

---

## §G — Final deployment recommendation

Do **not** promote to a real-user launch until the three release blockers in §F are cleared. The codebase itself is in good shape: the 10-market engine, database integrity model, superadmin authorization, approval/publishing flow, and audit trail are implemented correctly and independently verified.

**Before go-live:**
1. Provision a provider subscription that demonstrably supports 20 leagues + per-fixture enrichment; run a **bounded, authorized live probe** and record the actual quota/entitlement.
2. Confirm the deployed Vercel plan's function-duration limit ≥ 300s (or adapt the run).
3. In the target environment, verify live DB pooling, live Redis fail-closed behavior, and one authorized cron run end-to-end.
4. Add error monitoring (F-07) and confirm production secrets/security configuration.
5. Address the low/informational findings at the team's discretion (F-01, F-02, F-04, F-06).

**Verdict: B — CONDITIONALLY READY (82.1%).** Ready as a release candidate; production readiness is gated on external provisioning/entitlement verification, not on code correctness.

> Reminder (process compliance): no code was modified, and nothing was committed, pushed, deployed, or executed against production during this verification.
