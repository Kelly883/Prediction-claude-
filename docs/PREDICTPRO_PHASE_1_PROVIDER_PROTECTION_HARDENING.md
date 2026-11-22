# PredictPro — Phase 1 Provider Protection Hardening

**Task:** inspect and harden the existing Phase 1 provider-protection
implementation, addressing the outstanding findings from the *Provider Protection
& API Quota Control Audit (2026-11-22)*.

**Repository:** `Kelly883/Prediction-claude-`
**Date:** 2026-11-22
**Roles applied:** Principal Backend Engineer · API Integration Specialist ·
Distributed Systems Engineer · DevOps Engineer.

**Evidence labels used throughout:**

| Label | Meaning |
| --- | --- |
| **VERIFIED** | Demonstrated by code, a test, or actual provider evidence. |
| **DOCUMENTATION-VERIFIED** | Confirmed by official provider documentation. |
| **CALCULATED** | Mathematically derived from verified assumptions. |
| **MOCK-VERIFIED** | Demonstrated using mocked responses/store. |
| **NOT VERIFIED** | Requires live provider or production evidence. |

> **Scope restriction honoured.** Nothing was deployed, committed, pushed,
> production cron triggered, or production environment variable changed. No full
> live ingestion was run. All provider interactions in this task are mocked.

---

## 1. Initial findings (inspection summary)

Before any change, the four audit documents
(`docs/PHASE_1_PRODUCTION_READINESS_AUDIT.md`, `docs/PROVIDER_COVERAGE_REPORT.md`,
`docs/PREDICTPRO_PHASE_1_DATA_COMPLETENESS_REMEDIATION.md`,
`docs/PREDICTPRO_PROVIDER_PROTECTION.md`) and the named implementation files were
inspected. Key findings — **the documentation did not fully match the code**:

1. **Football-Data.org had no dedicated limiter.** It shared only the
   API-Football limiter's *concept*, not its state; the documentation implied
   protection that did not exist. (§2)
2. **API-Football used a fixed-window limiter.** `lib/api/rate-limiter.ts`
   incremented epoch-second / epoch-minute counters (`INCR`), which permit a
   boundary burst. (§3)
3. **Quota snapshot mixed measurement windows.** `buildQuotaSnapshot`
   preferentially combined `/status` daily fields with *daily header* values, and
   the daily and per-minute header pairs were read into the same logic — risking
   an internally inconsistent snapshot. (§4)
4. **`Retry-After` could be shortened.** `retry.ts` applied the header but its
   handling was not proven to keep the provider's full delay and had no
   execution-budget interaction. (§5)
5. **No execution-time budget.** The pipeline relied on individual waits being
   bounded; the *sum* over hundreds of fixtures was never modelled, and a
   mid-flight platform kill would leave a run stuck `running`. (§6)
6. **Single-flight outage behaviour was implicit.** A Redis failure during lock
   acquisition ran the loader directly, with no documented policy. (§7)
7. **Quota-refresh / ingestion scheduling order was documentation-only.** The
   provider-quota route was not scheduled and the required ordering was not
   enforced or recorded. (§8)
8. **Metrics were coarse.** They did not separate providers, distinguish a cache
   hit from an outbound request, or expose rate-limiter denials. (§9)
9. **Monitoring endpoint was thin.** It did not expose per-provider limits,
   Football-Data limiter status, freshness, blocked reason, etc. (§10)

**Preserved:** the 20 leagues, the 48-hour window, the 10-market engine, the
75-point threshold, eligibility rules, the approval/publishing workflow, payments,
auth, and the data-completeness remediation. No unnecessary refactoring was done.

**Likely-to-change files:** the `lib/api/*` provider-protection modules,
`lib/analysis/ingestion/*`, `lib/analysis/run.ts`, the cron + superadmin routes,
`.env.example`, the provider-protection doc, and the test suite.

---

## 2. Files changed

| Area | File | Change |
| --- | --- | --- |
| Rate limiting | [`lib/api/rate-limiter.ts`](file:///workspace/lib/api/rate-limiter.ts) | Replaced fixed-window with an atomic **sliding-window log** (`SLIDING_WINDOW_LUA`); added an **independent Football-Data.org** limiter; fail-closed + typed wait/deny metrics. |
| Config | [`lib/api/provider-config.ts`](file:///workspace/lib/api/provider-config.ts) | Added `footballData*` and `analysisMaxRuntimeMs` / `analysisBatchSize` fields (env-mapped, per-field fallback). |
| Retry | [`lib/api/retry.ts`](file:///workspace/lib/api/retry.ts) | `parseRetryAfter` (seconds + HTTP date, reject malformed/negative); honour `Retry-After` **in full**; abandon when it exceeds the budget. |
| Quota | [`lib/api/quota.ts`](file:///workspace/lib/api/quota.ts) | **Fixed** daily-source mixing (single-source selection); explicit per-minute fields; refresh lease; refuse-to-downgrade store guard. |
| Quota headers | [`lib/api/rate-limit-headers.ts`](file:///workspace/lib/api/rate-limit-headers.ts) | Daily/per-minute kept as **separate** fields; out-of-order captures ignored. (Verified/extended.) |
| Provider (FD) | [`lib/api/football-data.ts`](file:///workspace/lib/api/football-data.ts) | Every attempt (incl. retries) reserves a slot via `acquireFootballDataSlot()`; `fd:*` metrics + 429/auth/quota classification. |
| Provider (AF) | [`lib/api/football-api.ts`](file:///workspace/lib/api/football-api.ts) | `/status` typed fields; `af:*` metrics; genuine HTTP-attempt counting at the choke point. |
| Metrics | [`lib/api/provider-metrics.ts`](file:///workspace/lib/api/provider-metrics.ts) | Per-provider `af:*`/`fd:*` counters, cache, single-flight, quota-refresh, ingestion outcomes; day-scoped with TTL; no secrets. |
| Execution budget | [`lib/analysis/ingestion/budget.ts`](file:///workspace/lib/analysis/ingestion/budget.ts) | **New** CALCULATED estimator + `RunBudget`. |
| Analysis run | [`lib/analysis/run.ts`](file:///workspace/lib/analysis/run.ts) | Batched, idempotent, **resumable** run; `deferred` on budget exhaustion; skip already-persisted fixtures. |
| Single-flight | [`lib/analysis/ingestion/single-flight.ts`](file:///workspace/lib/analysis/ingestion/single-flight.ts) | Explicit `outagePolicy` (`fail-closed` \| `degrade`); observable; safe release preserved. |
| Cache | [`lib/analysis/ingestion/cache.ts`](file:///workspace/lib/analysis/ingestion/cache.ts) | `cachedProviderFetch` defaults to **fail-closed** outage policy; wires single-flight metrics. |
| Cron | [`app/api/cron/provider-quota/route.ts`](file:///workspace/app/api/cron/provider-quota/route.ts) | CRON_SECRET-guarded; refresh de-dup lease; documented required order. |
| Cron | [`app/api/cron/daily-analysis/route.ts`](file:///workspace/app/api/cron/daily-analysis/route.ts) | CRON_SECRET-guarded; records status + blocked reason in the audit log. |
| Monitoring | [`app/api/superadmin/analysis/provider-status/route.ts`](file:///workspace/app/api/superadmin/analysis/provider-status/route.ts) | Extended payload (see §10). |
| Schema | [`prisma/schema.prisma`](file:///workspace/prisma/schema.prisma) + [`0016_add_deferred_analysis_run_status/migration.sql`](file:///workspace/prisma/migrations/0016_add_deferred_analysis_run_status/migration.sql) | Non-destructive `deferred` enum value on `AnalysisRunStatus`. |
| Docs | [`.env.example`](file:///workspace/.env.example), [`docs/PREDICTPRO_PROVIDER_PROTECTION.md`](file:///workspace/docs/PREDICTPRO_PROVIDER_PROTECTION.md), [`docs/PHASE_1_PRODUCTION_READINESS_AUDIT.md`](file:///workspace/docs/PHASE_1_PRODUCTION_READINESS_AUDIT.md) | New env vars; algorithm/semantics corrections; Revision 3 cross-reference. |
| Tests | [`tests/provider-hardening.test.ts`](file:///workspace/tests/provider-hardening.test.ts) (new), [`tests/analysis-run.test.ts`](file:///workspace/tests/analysis-run.test.ts) | Hardening regressions + defer/resume tests. |

No existing tests were removed or weakened.

---

## 3. Implementation details

* **Both providers are always gated.** API-Football requests call
  `acquireApiFootballSlot()`; Football-Data.org requests call
  `acquireFootballDataSlot()`. There is no code path that issues an outbound
  provider request without first reserving a slot.
* **Retries re-reserve.** The reservation sits *inside* the retry attempt
  function, so a retry can never bypass the limiter and always acquires a fresh
  slot.
* **Fail closed.** Redis unavailability, or an unexpected Lua reply, raises
  `ProviderProtectionError` — never a silent bypass, for automated or manual
  paths.
* **Config is per-field and independent.** Each value parses independently and
  falls back to its conservative default on error, so one malformed value cannot
  relax protection.
* **Resumable ingestion.** The daily run iterates the full fixture set in durable
  batches; on budget exhaustion it checkpoints and marks the run `deferred` — it
  never truncates the list or publishes a partial run as `completed`.

---

## 4. Rate-limiter algorithms and guarantees

**Algorithm: sliding-window log** (atomic Lua over two Redis sorted sets per
provider — per-second and per-minute). Each granted reservation is a member
scored by its timestamp; the script evicts members older than the window
(`ZREMRANGEBYSCORE`) and compares `ZCARD` to the ceiling before `ZADD`.

```
ZREMRANGEBYSCORE s 0 now-1000 ; ZREMRANGEBYSCORE m 0 now-60000
if ZCARD s >= rps then return {0, waitToOldestSecond}
if ZCARD m >= rpm then return {0, waitToOldestMinute}
ZADD s now member ; ZADD m now member ; PEXPIRE s 2000 ; PEXPIRE m 61000
return {1, 0}
```

**Guarantees** (each MOCK-VERIFIED by [`tests/provider-hardening.test.ts`](file:///workspace/tests/provider-hardening.test.ts) §3):

1. Atomic Redis-side reservation (single script — no read-then-write race).
2. Correct across multiple serverless instances (shared Redis state).
3. No burst violating the sustained rate: **any 1000 ms window ≤ rps and any
   60 000 ms window ≤ rpm** — a boundary burst is impossible (the previous fixed
   window *did* allow one).
4. Independent per-second and per-minute ceilings.
5. Concurrent reservations serialised: two workers can never both take the final
   slot.
6. Bounded waiting (`PROVIDER_MAX_WAIT_MS` total, `PROVIDER_MAX_SLEEP_MS` per
   sleep, `maxAttempts` cap).
7. Fail closed on Redis error or unexpected script reply.
8. Every retry acquires a fresh reservation.

Why not a fixed window: a fixed epoch-second bucket grants `rps` at the end of
second *N* **and** `rps` at the start of second *N+1* — 2×`rps` inside 1 s. The
sliding log cannot. The old counters were **replaced**, not renamed.

---

## 5. Football-Data.org protection

* **Dedicated limiter**, separate keys (`provider:rl:football-data:s|m`) and
  separate config from API-Football. Changing one never affects the other.
* **Every** FD HTTP request — and every retry — passes through
  `acquireFootballDataSlot()` ([`football-data.ts`](file:///workspace/lib/api/football-data.ts#L41-L56)).
* **Conservative defaults** = the **documented Free-plan ceiling**:
  `FOOTBALL_DATA_RPS=1`, `FOOTBALL_DATA_RPM=10` (DOCUMENTATION-VERIFIED for the
  Free tier; the account's paid entitlement is **NOT VERIFIED**, so no higher
  value is assumed).
* **Fail closed** on Redis unavailability (same policy as API-Football).
* **Classification**: 429 → `ProviderRateLimitError` (recoverable, honours
  Retry-After), plan/subscription → `ProviderQuotaExhaustedError`, 401/403 auth →
  `ProviderAuthError`; 5xx → recoverable. Auth/quota never retry.
* **No uncontrolled fallback loops**: entitlement errors propagate out of
  `fetchFootballDataFixtures`; only recoverable per-endpoint failures are
  collected as `errors[]`. The circuit breaker counts recoverable failures only.
* **Metrics** `fd:httpRequests/success/failed/429/authFailures/quotaFailures/
  rateLimitWait/rateLimitDenied`; a cache hit never reaches the HTTP layer, so it
  is never counted as a request.
* **Open-Meteo untouched** (no existing safety issue identified).

---

## 6. Quota-header correction

`buildQuotaSnapshot` ([`quota.ts`](file:///workspace/lib/api/quota.ts#L80-L129)) now
enforces strict window separation:

* **Daily** uses **exactly one** source: `/status`
  (`response.requests.current` / `limit_day`) **or** the DAILY header pair
  (`x-ratelimit-requests-limit` / `-remaining`), else `unknown`. `remaining`
  and `consumed` are derived **within** that one source.
* **Per-minute** (`X-RateLimit-Limit` / `X-RateLimit-Remaining`) is stored in
  **separate** fields (`perMinuteLimit`, `perMinuteRemaining`, `perMinuteSource`)
  and is **never** used for daily consumption.
* Missing ⇒ `null` (never 0); if the daily window cannot be established, `status`
  stays `UNKNOWN`. `STALE` handling is preserved. Each measurement records its
  `source`. A newer valid snapshot is never overwritten by an older or
  incomplete refresh; out-of-order header captures are ignored.

> **Real bug found and fixed during this task.** Mock-VERIFIED by the test
> *"builds daily + per-minute from /status and headers without mixing"*: the prior
> code produced `remaining = 7000` (header) while `limit = 7500` / `consumed = 100`
> (`/status`) — an inconsistent snapshot. The single-source rewrite yields the
> correct `remaining = 7400`.

Field names are DOCUMENTATION-VERIFIED. **No authorized live `/status` response
was captured — live field/header mapping is NOT VERIFIED.**

---

## 7. Retry-After correction

`parseRetryAfter` ([`retry.ts`](file:///workspace/lib/api/retry.ts#L118-L133))
accepts **both** documented formats:

* integer / fractional **seconds** (`"120"`, `"5.5"`);
* **HTTP-date** (`"Wed, 21 Oct 2026 07:28:00 GMT"`, delta from the injected
  clock, floored at 0).

Rejected safely (⇒ `undefined` ⇒ fall back to backoff): empty, whitespace,
malformed, and any explicit negative value.

`withBoundedRetry` ([`retry.ts`](file:///workspace/lib/api/retry.ts#L139-L181)):

* honours the provider delay **in full** — it is **never** clamped down to
  `maxDelayMs` (only our own exponential backoff is capped);
* if `now() + delay > deadline` (`budgetMs`/`deadline`), the retry is
  **abandoned** — the attempt fails/defers safely rather than retrying early;
* auth/invalid-key/quota errors are **not** retried; retries are bounded
  (`PROVIDER_MAX_RETRIES`, clamped 0–5); a single attempt schedules at most one
  wait (no duplicate scheduling / no retry storm).

MOCK-VERIFIED by [`tests/provider-hardening.test.ts`](file:///workspace/tests/provider-hardening.test.ts) §5
(short/long delays, HTTP date, malformed, negative, empty, budget-exceeded, no
auth/quota retry).

---

## 8. Runtime calculation (execution-time budget)

**Model** ([`budget.ts`](file:///workspace/lib/analysis/ingestion/budget.ts)) —
CALCULATED from verified limits:

```
logicalRequests    = fixtures × requestsPerFixture        (requestsPerFixture = 6)
worstCaseRequests  = logicalRequests × (1 + maxRetries)   (PROVIDER_MAX_RETRIES = 2)
effectiveRps       = min(providerRps, providerRpm / 60)   = min(4, 4) = 4
limiterBoundMs     = ceil(worstCaseRequests / effectiveRps) × 1000
concurrencyBoundMs = ceil(fixtures / fixtureConcurrency) × providerTimeoutMs
                     (fixtureConcurrency = 10, providerTimeoutMs = 15000)
estimatedMs        = max(limiterBoundMs, concurrencyBoundMs) + dbOverheadMs (5000)
```

**Worked cases:**

| Workload | logical | worst-case | limiter bound | concurrency bound | estimate |
| --- | --- | --- | --- | --- | --- |
| 48 fixtures, no retries | 288 | 288 | 72 000 ms | 75 000 ms | **80 000 ms** |
| 48 fixtures, 2 retries (worst) | 288 | 864 | 216 000 ms | 75 000 ms | **221 000 ms** |
| 400 fixtures, no retries | 2 400 | 2 400 | 600 000 ms | 600 000 ms | **605 000 ms** |

**Realistic maximum workload:** the 48-hour window is bounded by the 20-league /
48-hour scope; the max supported fixture count used here is **48**. Its
worst-case estimate (retry-heavy) is **221 000 ms**.

**Safety margin:** the configured invocation budget default is
`PROVIDER_ANALYSIS_MAX_RUNTIME_MS = 240 000 ms`, below the route `maxDuration`
of 300 000 ms — a **60 000 ms (20 %)** headroom, and the retry-heavy 48-fixture
estimate (221 000 ms) **fits**. A 400-fixture workload (605 000 ms) **does not
fit** any single invocation — for which resumable batching is the mitigation.

**Enforcement & resumability** ([`run.ts`](file:///workspace/lib/analysis/run.ts)):
the run processes fixtures in durable batches (`PROVIDER_ANALYSIS_BATCH_SIZE`,
default 25) inside `$transaction` blocks with `createMany({ skipDuplicates: true })`
per batch. When the budget expires the run is marked **`deferred`** (new
non-destructive enum value, migration **0016**), returns a `blockedReason`, and a
later invocation **resumes** it — flipping back to `running` and **skipping
already-persisted fixtures**. The fixture list is never silently truncated, no
partial run is marked `completed`, and the existing
`AnalysisRun(runDate) WHERE status='running'` partial unique index still prevents
duplicate concurrent runs.

> **Recommendation:** keep `PROVIDER_ANALYSIS_MAX_RUNTIME_MS` comfortably below
> `maxDuration`, and schedule the daily cron often enough (or accept repetition)
> so a deferred run resumes and finishes. Live per-run latency is **NOT
> VERIFIED** (no live ingestion performed); the model is an upper bound.

---

## 9. Single-flight outage policy

When Redis is unavailable for single-flight locking, the explicit policy is:

* **`fail-closed` — the default for automated ingestion** (`cachedProviderFetch`):
  the fetch is refused with `SingleFlightError` instead of running the loader
  unguarded. Rationale: without a shared lock an uncontrolled number of workers
  could each issue the *same* provider request (a thundering herd), wasting quota
  and risking limit trips.
* **`degrade` — explicit and observable only:** the loader runs directly, but the
  event is **always observable** (`singleFlight:lockUnavailable` metric + a
  structured log). It is never silent.

The **global distributed limiter remains mandatory in both cases and is never
weakened** to make single-flight "work": every outbound request still reserves a
provider slot, so even degraded concurrency is bounded by the provider rate limit.
No path fabricates a cache result. Compare-and-delete (safe) lock release and
bounded waiter timeouts are preserved.

MOCK-VERIFIED by [`tests/provider-hardening.test.ts`](file:///workspace/tests/provider-hardening.test.ts) §7
(read failure ⇒ miss, fail-closed, concurrent misses, safe release, waiter
takeover after lock expiry, waiter timeout).

---

## 10. Provider metrics, observability and admin monitoring

**Metrics** (`provider:metrics:{day}:{name}`, 7-day TTL) — `af:*` and `fd:*`
tracked separately; a cache hit is **never** a provider request:

* per provider: `httpRequests` (actual outbound attempts), `success`, `failed`,
  `429`, `authFailures`, `quotaFailures`, `rateLimitWait`, `rateLimitDenied`,
  `fallbackActivated`;
* cache: `hit`, `miss`, `readFailure`, `writeFailure`;
* single-flight: `lockAcquired`, `contended`, `lockUnavailable`, `waiterTimeout`,
  `failed`;
* operational: `quota:refreshSuccess|refreshFailure|refreshSkipped`,
  `ingestion:completed|deferred|blocked`;
* legacy aliases: `provider:requests`, `provider:rateLimitWait`.

No key or field is derived from a secret. Missing counters read as `0` (never
fabricated non-zero).

**Admin monitoring** — `GET /api/superadmin/analysis/provider-status`
([route](file:///workspace/app/api/superadmin/analysis/provider-status/route.ts)),
still guarded by `requireAnalysisAdmin` (superadmin + 2FA), never exposed to
ordinary users. It now returns:

| Section | Contents |
| --- | --- |
| `quota` | AF daily quota (limit/consumed/remaining) **+ per-minute** (limit/remaining/source), status, source, level, ratio, reason |
| `quotaFreshness` | last refreshed, age, freshness window, `fresh`, status |
| `rateLimit` | AF internal limits (rps/rpm/maxWait) |
| `footballDataLimiter` | FD internal limits (rps/rpm/maxWait) |
| `thresholds` | warning/critical/stop + unknownPolicy |
| `circuits` | `api-football` / `football-data` open/closed |
| `cache` | hits/misses/hitRate/read+write failures |
| `singleFlight` | acquisitions/contention/unavailable/waiterTimeouts/failures |
| `metrics` | full per-provider + cache + single-flight snapshot |
| `lastRun` | status, counts, timestamps, and a `blockedReason` for `deferred` |

A frontend dashboard was **not** built (optional for this phase), per the brief.

---

## 11. Tests and results

New suite [`tests/provider-hardening.test.ts`](file:///workspace/tests/provider-hardening.test.ts)
(MOCK-VERIFIED / CALCULATED) plus additions to
[`tests/analysis-run.test.ts`](file:///workspace/tests/analysis-run.test.ts):

* **Distributed rate limiting** — concurrent reservations; multiple simulated
  workers; second-boundary and minute-boundary bursts; token/window exhaustion;
  Redis unavailable; unexpected Redis reply; retry acquiring another slot.
* **Football-Data.org** — independent limiter/keys; configurable limits; retry
  integration; 429; auth + quota failures; Redis failure.
* **Quota** — daily header mapping; per-minute header mapping; no mixing of
  windows; `/status` values; missing ⇒ UNKNOWN; stale snapshots; older snapshot
  cannot overwrite newer; 70/85/95 % thresholds.
* **Retries** — Retry-After seconds; HTTP date; delay beyond budget; no early
  retry; no auth/quota retry; no retry storm.
* **Single-flight** — concurrent cache misses; partial Redis failure; lock
  expiry; safe release; waiter timeout; no fabricated result.
* **Execution** — max-fixture workload; retry-heavy; rate-limiter wait-heavy;
  budget enforcement; resumable processing; no duplicate predictions; no
  partial-run success.
* **Security** — CRON_SECRET enforcement (401 without/with wrong secret; 200 with
  correct); superadmin authorization (403 for non-superadmin); no secret leakage
  in logs or API responses.

**Results (§14 — see also the verification run below):**

| Check | Result |
| --- | --- |
| `vitest run` (full suite) | **542 passed / 5 skipped** (66 files) — no failures |
| `tsc --noEmit` (local 5.9.3) | clean |
| `prisma validate` (placeholder URLs) | schema valid |
| `prisma generate` | succeeds |
| `npm run build` | succeeds |

All provider-behaviour results are **MOCK-VERIFIED**; **none prove live provider
behaviour** (NOT VERIFIED).

---

## 12. Remaining risks

1. **No live provider verification.** `/status` fields and header names are
   documentation-verified, not capture-verified. A live probe is required before
   claiming live behaviour. — NOT VERIFIED
2. **Live runtime unmeasured.** The runtime model is an upper bound (CALCULATED);
   real per-run latency depends on provider/DB behaviour. — NOT VERIFIED
3. **Cron ordering not yet scheduled.** Provider-quota → daily-analysis must be
   scheduled in production; until then quota is `UNKNOWN` and ingestion is blocked
   (fail-closed, by design). — NOT VERIFIED (operational)
4. **Football-Data paid entitlement unconfirmed.** Defaults assume the Free-plan
   ceiling. — NOT VERIFIED
5. **Monitoring UI not wired.** Backend endpoint only.
6. **`Retry-After` budget interaction is code-supported** (`budgetMs`/`deadline`)
   but no current caller passes a per-call budget; the run-level `RunBudget` is
   the effective guard. — PARTIALLY VERIFIED
7. **Dev/test in-memory Redis** does not enforce cross-process limits (development
   convenience only; production requires distributed Redis).

---

## 13. Production configuration requirements & evidence labels

**Required/important production variables** (all optional in code; defaults
shown). Full list in [`.env.example`](file:///workspace/.env.example) and
[`docs/PREDICTPRO_PROVIDER_PROTECTION.md`](file:///workspace/docs/PREDICTPRO_PROVIDER_PROTECTION.md) §14.

```
PROVIDER_RPS=4                          # AF internal safety limit
PROVIDER_RPM=240
PROVIDER_MAX_WAIT_MS=10000
PROVIDER_MAX_SLEEP_MS=1000
FOOTBALL_DATA_RPS=1                     # FD = documented Free-plan ceiling
FOOTBALL_DATA_RPM=10
FOOTBALL_DATA_MAX_WAIT_MS=10000
FOOTBALL_DATA_MAX_SLEEP_MS=1000
PROVIDER_QUOTA_WARNING_THRESHOLD=0.7
PROVIDER_QUOTA_CRITICAL_THRESHOLD=0.85
PROVIDER_QUOTA_STOP_THRESHOLD=0.95
PROVIDER_QUOTA_FRESHNESS_SECONDS=1800
PROVIDER_QUOTA_SNAPSHOT_TTL_SECONDS=86400
PROVIDER_QUOTA_UNKNOWN_POLICY=block
PROVIDER_ENRICHMENT_CONCURRENCY=10
PROVIDER_ANALYSIS_MAX_RUNTIME_MS=240000  # must stay below route maxDuration (300s)
PROVIDER_ANALYSIS_BATCH_SIZE=25
PROVIDER_SINGLE_FLIGHT_LOCK_TTL_MS=15000
PROVIDER_SINGLE_FLIGHT_WAIT_MS=18000
PROVIDER_SINGLE_FLIGHT_POLL_MS=150
```

Plus (pre-existing): `API_FOOTBALL_KEY`, `FOOTBALL_DATA_API_KEY`,
`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `CRON_SECRET`,
`PROVIDER_MAX_RETRIES`, `PROVIDER_RETRY_BASE_MS`, `PROVIDER_RETRY_MAX_MS`,
`PROVIDER_CIRCUIT_*`.

**Required production cron ordering** (documented; **not scheduled here**):

1. `/api/cron/provider-quota` — refresh quota, confirm fresh/valid. (e.g. `0 5 * * *`)
2. `/api/cron/daily-analysis` — evaluate the gate, then run. (existing `0 6 * * *`)

Both routes enforce `CRON_SECRET`. A failed refresh is recorded as failure (never
success) and leaves the snapshot `UNKNOWN`/`STALE`, which blocks automated
ingestion under the default policy.

**Evidence labels for the important claims:**

| Claim | Label |
| --- | --- |
| Sliding-window limiter is atomic, burst-free, multi-instance safe | MOCK-VERIFIED (§3 tests) + CALCULATED |
| Fixed-window counters were replaced (not renamed) | VERIFIED (code + §3 Lua-shape test) |
| FD limiter is independent and gates every request/retry | VERIFIED (code) + MOCK-VERIFIED (tests) |
| FD Free-plan ceiling = 10 req/min | DOCUMENTATION-VERIFIED |
| Quota daily/per-minute separation & single-source selection | MOCK-VERIFIED (bug found + fixed) |
| `/status` field names / header names | DOCUMENTATION-VERIFIED (live = NOT VERIFIED) |
| Retry-After seconds + HTTP date; full delay; budget abandon | MOCK-VERIFIED |
| Runtime model (80 000 ms / 221 000 ms / 605 000 ms) | CALCULATED |
| Resumable, idempotent, deferred run; no partial success | VERIFIED (code) + MOCK-VERIFIED (tests) |
| Single-flight fail-closed default; limiter never weakened | VERIFIED (code) + MOCK-VERIFIED (tests) |
| Metrics separate providers; cache hit ≠ request; no secrets | MOCK-VERIFIED |
| CRON_SECRET / superadmin enforcement | MOCK-VERIFIED (tests) |
| Live provider latency / quota / entitlement | NOT VERIFIED |
| Production cron scheduled / ordering in effect | NOT VERIFIED (not performed by design) |

---

## Findings status & verdict

| # | Original finding (§) | Status |
| --- | --- | --- |
| F1 | No dedicated Football-Data.org limiter (§2) | **CLOSED** — independent shared limiter, fail-closed, tested. Live entitlement NOT VERIFIED. |
| F2 | Fixed-window boundary burst (§3) | **CLOSED** — sliding-window log with boundary/simultaneous tests. |
| F3 | Quota header/window mixing (§4) | **CLOSED** — single-source daily selection; bug found and fixed; regression tests. |
| F4 | Retry-After could be shortened (§5) | **CLOSED** — seconds + HTTP date; full delay; budget-aware abandon; tests. |
| F5 | No execution-time budget (§6) | **CLOSED** — CALCULATED model, safety margin, resumable/deferred batches, tests. Live runtime NOT VERIFIED. |
| F6 | Single-flight outage undefined (§7) | **CLOSED** — explicit fail-closed default + observable degrade; limiter preserved; tests. |
| F7 | Quota-refresh / scheduling readiness (§8) | **PARTIALLY CLOSED** — guards, CRON_SECRET, dedupe, recorded outcomes, documented order implemented; **production cron not scheduled** (forbidden this task). |
| F8 | Coarse metrics (§9) | **CLOSED** — per-provider counters, cache vs. request distinction, day-scoped. |
| F9 | Thin monitoring endpoint (§10) | **CLOSED** — backend payload extended; frontend dashboard optional/deferred. |

### Verdict

**CONDITIONAL PASS** — the code is hardened and green (542 passing tests, clean
type-check, valid schema, successful build), and every code-level finding is
closed. Full acceptance is conditional on **operational** evidence that this task
was explicitly forbidden from producing: an authorized live provider probe
(`/status` + header mapping), a scheduled provider-quota → daily-analysis cron
order, and a measured live run vs. the CALCULATED budget. Until then, findings F1,
F5 and F7 carry a **NOT VERIFIED** operational caveat.

---

*Stop point: implementation, testing and documentation complete. No deployment,
commit, push, production cron trigger, full live ingestion, or production
environment change was performed. Awaiting approval.*
