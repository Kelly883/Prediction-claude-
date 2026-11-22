# PredictPro — Phase 1 Provider Protection & API Quota Control

Scope: how PredictPro stops itself from exhausting the football-data provider API
quota, violating rate limits, issuing duplicate requests, retrying uncontrolled,
or silently degrading data.

This document is the design + operations reference for the provider-protection
layer implemented in this change. It is **implementation documentation**: it
describes what the code does today, what is verified from provider documentation,
and what is explicitly *not* verified (no authorized live provider response was
obtained while writing this).

Companion documents: [`PHASE_1_PRODUCTION_READINESS_AUDIT.md`](file:///workspace/docs/PHASE_1_PRODUCTION_READINESS_AUDIT.md),
[`PROVIDER_COVERAGE_REPORT.md`](file:///workspace/docs/PROVIDER_COVERAGE_REPORT.md),
[`PREDICTPRO_PHASE_1_DATA_COMPLETENESS_REMEDIATION.md`](file:///workspace/docs/PREDICTPRO_PHASE_1_DATA_COMPLETENESS_REMEDIATION.md).

---

## 0. Provider-documented limits vs. internal safety limits

These are **different things** and must never be conflated.

| Kind | Meaning | Where set | Values |
| --- | --- | --- | --- |
| **Provider-documented** | What the provider's plan *entitles* you to. | Provider docs / your plan. Not stored in code. | API-Football free plan = **100 requests/day**; paid plans publish per-minute/per-second *examples* (see §3). Football-Data.org free = **10 requests/min**, 12 competitions. |
| **Internal safety limits** | Self-imposed ceilings that bound **all** traffic regardless of plan, so a burst across concurrent serverless workers cannot exhaust the account. Intentionally more conservative than any paid tier. | `lib/api/provider-config.ts`, env vars `PROVIDER_*`. | `PROVIDER_RPS=4`, `PROVIDER_RPM=240`. |

**Rule:** none of the internal limits are a claim about the provider's official
entitlement, and the code never auto-raises them based on an assumption about plan
capacity. They only change through validated server-side environment variables.

---

## 1. Existing provider architecture (Stage 1 audit)

### 1.1 Providers

| Provider | Role | Base URL | Auth header | Client |
| --- | --- | --- | --- | --- |
| **API-Football** (api-sports.io) v3 | Primary (fixtures + full enrichment) | `https://v3.football.api-sports.io` | `x-apisports-key` | [`lib/api/football-api.ts`](file:///workspace/lib/api/football-api.ts) |
| **Football-Data.org** v4 | Secondary / fallback | `https://api.football-data.org/v4` | `X-Auth-Token` | [`lib/api/football-data.ts`](file:///workspace/lib/api/football-data.ts) |
| **Open-Meteo** | Weather (no API key) | Open-Meteo REST | none | [`lib/analysis/ingestion/weather.ts`](file:///workspace/lib/analysis/ingestion/weather.ts) |

### 1.2 Single choke-point per provider

Every API-Football call funnels through the private `request()` in
[`football-api.ts`](file:///workspace/lib/api/football-api.ts#L52-L122). Every
Football-Data call funnels through its own `request()`. This is what makes a
**global** limiter enforceable — there is no second path that bypasses it.

### 1.3 API-Football endpoints and callers

| Endpoint | Fetcher | Called per | Cache key |
| --- | --- | --- | --- |
| `/fixtures` | `fetchApiFootballFixtures` | **league** (loop over enabled leagues) | `api-football:fixtures:{code}:{from}:{to}` |
| `/teams/statistics` | `fetchTeamStats` | **fixture × 2** (home + away) | `api-football:team-stats:{teamId}:{leagueId}:{season}` |
| `/fixtures/headtohead` | `fetchH2H` | **fixture** | `api-football:h2h:{homeId}:{awayId}` |
| `/injuries` | `fetchInjuries` | **fixture** | `api-football:injuries:{fixtureId}` |
| `/odds` | `fetchOdds` | **fixture** | `api-football:odds:{fixtureId}` |
| `/players/topscorers` | `fetchScorers` | **fixture** (same league+season repeats) | `api-football:scorers:{leagueId}:{season}` |
| `/status` | `fetchApiFootballStatus` | quota monitor (does **not** count against daily quota) | n/a (not cached) |

`fetchApiFootballEnrichment` issues the enrichment calls for one fixture as
**six parallel requests** via `Promise.all` (home stats, away stats, h2h,
injuries, odds, scorers). Fixtures themselves are processed by
`mapWithConcurrency` at a configurable concurrency (§11).

### 1.4 Football-Data.org and Open-Meteo

* Football-Data `fetchFootballDataFixtures` and `fetchFootballDataEnrichment`
  mirror the primary shape (fixtures per league; enrichment per fixture). It is a
  **fallback only** and is not claimed to be equivalent to API-Football (§12).
* Open-Meteo weather is fetched per fixture inside enrichment, and is **not**
  routed through the API-Football limiter (it is a different provider with its own
  generous limits and no key).

### 1.5 Request flow (text diagram)

```
runDailyAnalysis (lib/analysis/run.ts)
  └─ evaluateIngestionGate                      ← Stage 9 pre-flight (reads only)
  └─ fetchFixtures                              ← lib/analysis/ingestion/fixtures.ts
  │    └─ per league: cachedProviderFetch('api-football:fixtures:…')
  │         └─ request('/fixtures')             ← API-Football
  └─ enrichFixtures (mapWithConcurrency, limit=PROVIDER_ENRICHMENT_CONCURRENCY)
  │    └─ per fixture:
  │         ├─ fetchApiFootballEnrichment        (primary)
  │         │    └─ 6 × Promise.all:
  │         │         cachedProviderFetch(key) → request('/teams/statistics' | '/fixtures/headtohead'
  │         │                                     | '/injuries' | '/odds' | '/players/topscorers')
  │         ├─ (on recoverable primary failure) fetchFootballDataEnrichment (degraded, §12)
  │         └─ fetchWeather (Open-Meteo)

request() [both providers]:
  assertProviderAvailable(provider)             ← circuit breaker
  withBoundedRetry(provider, attempt):
    attempt():
      acquireApiFootballSlot()                   ← GLOBAL distributed limiter (last authority)
      fetch(url)
      captureRateLimitHeaders(response) → store
      on !ok: providerErrorFromResponse(status, body, Retry-After)
      on body.errors: classifyApiFootballErrors (quota/auth/other)
      on success: recordProviderSuccess
```

* **Which requests are cached:** all API-Football and Football-Data *data*
  fetches go through `cachedProviderFetch`. `/status` is intentionally uncached.
* **Which can run concurrently:** enrichment is concurrent (per fixture, and 6
  calls inside each fixture), plus league fixture loops run sequentially.
* **Which are retried:** only *recoverable* failures (network, timeout, 5xx,
  429). Each retry re-enters `acquireApiFootballSlot()` (§8).
* **Which errors trigger fallback:** any *recoverable* primary failure degrades to
  Football-Data for that fixture; **auth/quota never degrade** — they abort (§12).
* **Where quota / rate-limit info is recorded:** `provider:quota:api-football`
  (snapshot), `provider:quota:api-football:headers` (captured headers), and the
  day-scoped metric counters (§13).

No code was modified until this inspection was complete.

---

## 2. Rate-limiting design (Stage 2)

### 2.1 Why distributed

Vercel functions execute independently and can scale out. A per-process counter
would let N workers each spend the full budget. The limiter state therefore lives
in **shared Redis** so the limit holds across every concurrent worker.

### 2.2 Mechanism — one atomic Lua reservation

Every attempt calls `acquireApiFootballSlot()`
([`lib/api/rate-limiter.ts`](file:///workspace/lib/api/rate-limiter.ts)). It calls
a Redis `eval` of `RATE_LIMIT_LUA`, which atomically increments **both** fixed
windows (per-second and per-minute) and returns `{allowed, waitMs}`:

```lua
local sec = redis.call('INCR', KEYS[1])
if sec == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[3]) end
if sec > tonumber(ARGV[1]) then
  local ttl = redis.call('PTTL', KEYS[1]); if ttl < 0 then ttl = 0 end
  return {0, ttl}
end
local minute = redis.call('INCR', KEYS[2])
if minute == 1 then redis.call('PEXPIRE', KEYS[2], ARGV[4]) end
if minute > tonumber(ARGV[2]) then
  local ttl = redis.call('PTTL', KEYS[2]); if ttl < 0 then ttl = 0 end
  return {0, ttl}
end
return {1, 0}
```

Keys: `provider:rl:api-football:s:{epochSecond}` and
`provider:rl:api-football:m:{epochMinute}`. Because the check-and-reserve is a
single server-side script, **two workers can never both be granted the same final
slot**, and state survives individual function termination.

### 2.3 Required behaviour implemented

1. Check the shared limiter (read the windows) — inside the Lua script.
2. Reserve capacity atomically.
3. If the permitted rate is reached, **wait** (`min(max(waitMs,50), maxSleepMs)`)
   and re-check, up to `PROVIDER_MAX_WAIT_MS`.
4. If a slot still cannot be obtained within the bounded wait, **fail closed** by
   throwing `ProviderProtectionError` (a non-recoverable `ProviderError`). It does
   **not** proceed without a slot.
5. Only after a successful reservation does the HTTP request execute.

### 2.4 Redis failure behaviour

`redisReserve` catches any Redis error and throws `ProviderProtectionError`
("API-Football rate limiter unavailable"). There is **no** code path that bypasses
the distributed limiter on a Redis outage, for automated *or* manual operations.
An unknown/unexpected Lua result shape is also treated as *not allowed*.

### 2.5 Configuration (no code change required)

Limits are read from validated env through
[`lib/api/provider-config.ts`](file:///workspace/lib/api/provider-config.ts):

| Env var | Field | Default |
| --- | --- | --- |
| `PROVIDER_RPS` | requests / second | `4` |
| `PROVIDER_RPM` | requests / minute | `240` |
| `PROVIDER_MAX_WAIT_MS` | max total wait for a slot | `10000` |
| `PROVIDER_MAX_SLEEP_MS` | max single sleep between re-checks | `1000` |

Each field parses independently and falls back to its conservative default if
malformed, so a single bad value cannot crash the runtime or drop the other
settings.

---

## 3. Configured request limits (Stage 2)

| Limit | Value | Nature |
| --- | --- | --- |
| Per second | **4** | Internal safety limit |
| Per minute | **240** | Internal safety limit |

These bound **all** API-Football traffic including retries, across **all**
serverless instances. They are intentionally conservative and are **not** derived
from, nor a claim about, the provider's published plan capacity. For context only,
API-Football's *documented plan examples* describe much higher per-minute/second
ceilings on paid tiers (e.g. Pro ≈ 300/min or 5/s; Ultra ≈ 450/min or 7/s; Mega
≈ 900/min or 15/s) and a free tier of ~100 requests/day — **we do not rely on
those numbers** and never raise our limits on that basis.

---

## 4. Redis coordination mechanism (Stage 2/5)

* Client: [`lib/redis.ts`](file:///workspace/lib/redis.ts) — a lazy Proxy singleton.
* Production **requires** a distributed Redis (`UPSTASH_REDIS_REST_URL` /
  `UPSTASH_REDIS_REST_TOKEN`); if absent it throws rather than silently using an
  in-memory store. In dev/test it falls back to a process-local stub.
* Atomic operations used: `eval`/`evalsha` (limiter reservation + single-flight
  lock release), `set … NX EX`, `incr`, `get`, `del`.
* Rate-limit windows use `INCR` + `PEXPIRE` inside Lua.
* Single-flight locks use `SET key token NX EX <ttl>` and compare-and-delete
  release (§9).

---

## 5. Quota monitoring source and verified response fields (Stage 3)

Implemented in [`lib/api/quota.ts`](file:///workspace/lib/api/quota.ts) and
[`lib/api/rate-limit-headers.ts`](file:///workspace/lib/api/rate-limit-headers.ts).

**Verified sources only** (no invented field names):

1. **`/status` endpoint** (documented not to count against the daily quota):
   * `response.requests.current` → requests consumed today.
   * `response.requests.limit_day` → daily allocation.
   * `response.subscription.{plan,end,active}` → plan metadata (no account
     identity is ever read or stored).
2. **Response headers** (documented names): `x-ratelimit-requests-limit`,
   `x-ratelimit-requests-remaining`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`.
   These are captured for observability and as a fallback limit/remaining source.

**Snapshot** (`provider:quota:api-football`, TTL `PROVIDER_QUOTA_SNAPSHOT_TTL_SECONDS`):

| Field | Notes |
| --- | --- |
| `provider` | `api-football` |
| `plan`, `subscriptionEnd` | from `/status` subscription (optional) |
| `dailyLimit` | `requests.limit_day`, else header limit, else `null` |
| `consumed` | `requests.current`, else derived from a matched header (limit − remaining), else `null` |
| `remaining` | header remaining, else `limit − consumed`, else `null` |
| `lastCheckedAt` | ISO time of the check |
| `status` | `OK` / `STALE` / `UNKNOWN` |
| `source` | `status-endpoint` / `headers` / `unknown` |

**Never assume an unavailable value is zero.** Missing values are `null` and the
snapshot is labelled `UNKNOWN`. Old snapshots are re-labelled `STALE` by
`getProviderQuota` when older than `PROVIDER_QUOTA_FRESHNESS_SECONDS`.

Refresh is performed by a **dedicated** route
([`app/api/cron/provider-quota/route.ts`](file:///workspace/app/api/cron/provider-quota/route.ts))
so the daily analysis run never performs a live quota refresh inline. The
superadmin monitoring endpoint can also refresh on demand (`?refresh=1`). Both
paths go through the global limiter.

> **Note (verified vs. unverified):** the `/status` field names above are taken
> from the provider's documentation. **No authorized live `/status` response was
> obtained in this change**, so the field names are documentation-verified, not
> capture-verified.

---

## 6. Warning thresholds (Stage 3)

Configurable consumption thresholds (ratio of `consumed / dailyLimit`):

| Level | Default | Behaviour |
| --- | --- | --- |
| Warning | **70%** (`PROVIDER_QUOTA_WARNING_THRESHOLD`) | surfaced to admins |
| Critical warning | **85%** (`PROVIDER_QUOTA_CRITICAL_THRESHOLD`) | surfaced to admins |
| Stop | **95%** (`PROVIDER_QUOTA_STOP_THRESHOLD`) | **block new automated ingestion** |

`assessQuota` returns `ok | warning | critical | stop | unknown | stale`.
`UNKNOWN`/`STALE` are treated conservatively (see §7), never as "unlimited".

---

## 7. Quota exhaustion policy (Stage 3/4)

At/above the **stop** threshold, or when quota is `UNKNOWN`/`STALE` under the
default policy:

* New automated-ingestion requests are **blocked** (`evaluateQuotaGate`).
* No further full daily analysis run is started (Stage 9 gate).
* Already-collected data is **preserved** — no destructive action.
* No incomplete predictions are published, and the run is never marked successful.
* The reason is recorded (`blockedReason`, structured logs) for monitoring.

The `unknown`/`stale` behaviour is configurable:
`PROVIDER_QUOTA_UNKNOWN_POLICY='block'` (default, fail closed) or `'warn'`
(proceed but flag the reason). Whether quota information is missing because it
could not be fetched is recorded — missing data never implies unlimited capacity.

---

## 8. Retry policy (Stage 4)

Retries live in [`lib/api/retry.ts`](file:///workspace/lib/api/retry.ts)
(`withBoundedRetry`) and classification in
[`lib/api/failure-classification.ts`](file:///workspace/lib/api/failure-classification.ts).

### 8.1 Failure classification

| Category | Source | Recoverable | Action |
| --- | --- | --- | --- |
| `auth` | `ProviderAuthError` (403 not subscribed/plan) | **no** | stop automated ingestion; record; no retry |
| `invalid_key` | `ProviderAuthError` (401) | **no** | stop; record; no retry |
| `quota` | `ProviderQuotaExhaustedError` | **no** | stop; record; no retry storm |
| `rate_limit` | `ProviderRateLimitError` (429) | yes | bounded retry, honour `Retry-After` |
| `server` | HTTP 5xx | yes | bounded retry |
| `network` | fetch/connection errors | yes | bounded retry |
| `timeout` | `TimeoutError`/`AbortError` | yes | bounded retry |
| `invalid_response` | non-recoverable provider error body | no | record |
| `missing_data` | provider returned no usable data (a gap, not an error) | no | recorded explicitly |

### 8.2 Rules

* **Auth / invalid key / quota:** never retried repeatedly — `withBoundedRetry`
  rethrows non-recoverable errors immediately.
* **Recoverable:** exponential backoff with a hard cap (`PROVIDER_MAX_RETRIES`
  default 2, `PROVIDER_RETRY_BASE_MS`, `PROVIDER_RETRY_MAX_MS`); a 429's
  `Retry-After` is parsed (`parseRetryAfter`) and respected, with a sane cap.
* **Every retry passes through the global limiter** — `acquireApiFootballSlot()`
  is called inside the retry attempt function, so a retry cannot bypass the rate
  control or the concurrency controls.
* The circuit breaker counts only *recoverable* failures; auth/quota are surfaced
  and never masked.

---

## 9. Cache and single-flight design (Stage 5)

The previous cache used a naive `get → loader → set`: on a cold key, N concurrent
workers each missed and each issued the **same** provider request. That is now
serialised by [`lib/analysis/ingestion/single-flight.ts`](file:///workspace/lib/analysis/ingestion/single-flight.ts),
wrapped by [`lib/analysis/ingestion/cache.ts`](file:///workspace/lib/analysis/ingestion/cache.ts)
`cachedProviderFetch`.

Algorithm for key `k`:

1. Read cache. Hit → return (counts a cache hit).
2. Miss → attempt `SET k:__lock <token> NX EX <lockTtl>`.
3. **Lock owner**: run the loader; cache the result (unless non-cacheable); then
   release the lock. Waiters read the owner's cached result.
4. **Waiter**: poll the cache up to `PROVIDER_SINGLE_FLIGHT_WAIT_MS`
   (`PROVIDER_SINGLE_FLIGHT_POLL_MS` interval). If the owner fails, the waiter
   times out with `SingleFlightError` — it is **never** handed fabricated data.

Safety properties:

* **Unique ownership token** (`randomUUID`) per acquisition.
* **Safe release**: `RELEASE_LOCK_LUA` compare-and-delete — a previous owner can
  never delete a lock it no longer holds (e.g. after TTL expiry + re-acquire).
* **Bounded wait** and **lock TTL** (`PROVIDER_SINGLE_FLIGHT_LOCK_TTL_MS` default
  15000, wait 18000) sized to exceed normal provider latency.
* **No permanent locks**: the owner releases in a `finally`, even if the loader
  throws.
* **Redis unavailable for locking**: single-flight is skipped and the loader runs
  directly — **the global rate limiter still bounds traffic**, so this is not a
  protection bypass.
* **Loader failure** propagates to the owner; waiters get a clear
  failure/timeout, not an invented success.

---

## 10. Cache TTL decisions (Stage 6)

The previous single default TTL was 24h while the daily cron also ran every 24h,
so many daily requests were cold-cache. TTLs are now endpoint-specific
(`resolveCacheTtlSeconds`), configurable via `PROVIDER_CACHE_TTL_*_SECONDS`
(all in seconds):

| Data | Key match | Env var | Default | Why |
| --- | --- | --- | --- | --- |
| Odds | `:odds` | `PROVIDER_CACHE_TTL_ODDS_SECONDS` | 900 (15m) | move continuously; must stay fresh |
| Fixtures | `:fixtures` | `PROVIDER_CACHE_TTL_FIXTURES_SECONDS` | 7200 (2h) | kickoff/status can change |
| Injuries | `:injuries` | `PROVIDER_CACHE_TTL_INJURIES_SECONDS` | 21600 (6h) | change during the day, not minute-to-minute |
| Team stats / standings | `:team-stats` `:standings` | `PROVIDER_CACHE_TTL_TEAM_STATS_SECONDS` | 86400 (24h) | change slowly |
| Head-to-head | `:h2h` | `PROVIDER_CACHE_TTL_H2H_SECONDS` | 86400 (24h) | effectively static within a season |
| Top scorers | `:scorers` | `PROVIDER_CACHE_TTL_SCORERS_SECONDS` | 43200 (12h) | change slowly |
| Weather | `weather:` | `PROVIDER_CACHE_TTL_WEATHER_SECONDS` | 3600 (1h) | forecast drift |
| Default | anything else | `PROVIDER_CACHE_TTL_DEFAULT_SECONDS` | 86400 (24h) | slow-moving enrichment |

Key-completeness and safety:

* Keys include the identifiers they need: league code (`:fixtures:PL:…`), team id +
  provider league id + season (`:team-stats:{teamId}:{leagueId}:{season}`), fixture
  id (`:injuries:{fixtureId}`, `:odds:{fixtureId}`), and the fixture/date window
  (`:fixtures:{code}:{from}:{to}`).
* **Invalid responses are not cached**, and **`null`/`undefined` are never
  cached**.
* **Auth/quota failures are never cached** — `cachedProviderFetch` lets
  `ProviderQuotaExhaustedError` / `ProviderAuthError` propagate so an exhausted
  provider can never look healthy.
* Cache expiration is observable via TTLs plus the miss counter (§13).

> We deliberately make **no claim** that this caching guarantees a specific %
> reduction in API calls — the benefit depends on run cadence and data churn.

---

## 11. Concurrency controls (Stage 7)

* Enrichment runs under `mapWithConcurrency` with a **configurable** limit:
  `PROVIDER_ENRICHMENT_CONCURRENCY` (default 10, clamped 1–20). Each fixture can
  still fan out up to **6 parallel** API-Football requests.
* The global distributed limiter remains the **final authority**: every one of
  those requests (and every retry) reserves a slot. Reducing concurrency alone is
  **not** treated as sufficient.
* Retries cannot bypass concurrency or rate controls (§8.2).
* A single fixture failure does not abort unrelated fixtures: `safe(...)` in
  `fetchApiFootballEnrichment` swallows *recoverable* per-endpoint failures and
  records them; only entitlement errors (auth/quota) abort the whole run.
* The daily run stays within Vercel execution limits by bounding concurrency and
  the per-attempt wait (`PROVIDER_MAX_WAIT_MS`).

---

## 12. Fallback policy (Stage 4)

* `settings.dataSourcePriorities` drives provider order; API-Football is primary.
* **Fallback only on recoverable primary failure.** On fallback:
  * the failure is recorded (`provider.fallback.activated` log; `errors[]`),
  * the result is marked **degraded** (`degradedFrom`) and never labelled as
    complete primary enrichment, and
  * the existing market-eligibility / enrichment-quality rules still apply so
    unsupported markets are not generated or published.
* **Football-Data.org is used only for what it genuinely supports.** It does not
  provide API-Football's full enrichment (e.g. head-to-head, injuries, odds); those
  remain absent/`missing_data` rather than being invented. A fallback response
  can therefore never silently make incomplete enrichment appear complete.
* **Auth/quota do not fall back** — they are thrown before any provider switch,
  because an exhausted entitlement is not a per-endpoint degradation.

---

## 13. Monitoring and logging (Stage 8)

### 13.1 Structured events

`logger` structured events (JSON) include, per request: provider, endpoint, status,
duration, error category; plus `provider.rateLimit.wait/acquired/waitExceeded`,
`provider.quota.refreshed/storeFailed/readFailed`, `provider.fallback.activated`,
`football.cache.readFailed/writeFailed/lockUnavailable/lockReleaseFailed`,
`provider.ingestionGate`, and `analysis.run.{started,completed,failed,blocked}`.

### 13.2 Day-scoped metrics (`lib/api/provider-metrics.ts`)

Counters in Redis (`provider:metrics:{day}:{name}`, 7-day TTL):
`cache:hit`, `cache:miss`, `cache:readFailure`, `cache:writeFailure`,
`singleFlight:lockAcquired`, `singleFlight:contended`, `provider:requests`,
`provider:rateLimitWait`. These expose cache effectiveness, single-flight
contention, provider-request volume and duplicate-request prevention.

### 13.3 Admin visibility

`GET /api/superadmin/analysis/provider-status`
([route](file:///workspace/app/api/superadmin/analysis/provider-status/route.ts))
guarded by the **existing** `requireAnalysisAdmin` authorization; never exposed to
ordinary users. Returns: quota (level, ratio, reason), internal rate-limit config,
thresholds, circuit states, metrics, and the last ingestion run. `?refresh=1`
re-polls `/status` (through the limiter); that is the only provider request here.

> **Remaining UI work:** this change exposes the **backend monitoring endpoint**.
> Wiring a dashboard screen to it in the superadmin UI is out of the safe scope of
> this change and is tracked as follow-up.

### 13.4 Never logged

API keys, `Authorization`/`x-apisports-key`/`X-Auth-Token` headers, DB passwords,
Redis credentials, or full sensitive env values. Logs carry only numeric/state
fields.

---

## 14. Required environment variables (Stage 11)

All optional; defaults shown. Documented in [`.env.example`](file:///workspace/.env.example)
and typed in [`lib/env.ts`](file:///workspace/lib/env.ts).

```
PROVIDER_RPS=4
PROVIDER_RPM=240
PROVIDER_MAX_WAIT_MS=10000
PROVIDER_MAX_SLEEP_MS=1000
PROVIDER_QUOTA_WARNING_THRESHOLD=0.7
PROVIDER_QUOTA_CRITICAL_THRESHOLD=0.85
PROVIDER_QUOTA_STOP_THRESHOLD=0.95
PROVIDER_QUOTA_FRESHNESS_SECONDS=1800
PROVIDER_QUOTA_SNAPSHOT_TTL_SECONDS=86400
PROVIDER_QUOTA_UNKNOWN_POLICY=block
PROVIDER_ENRICHMENT_CONCURRENCY=10
PROVIDER_SINGLE_FLIGHT_LOCK_TTL_MS=15000
PROVIDER_SINGLE_FLIGHT_WAIT_MS=18000
PROVIDER_SINGLE_FLIGHT_POLL_MS=150
PROVIDER_CACHE_TTL_DEFAULT_SECONDS=86400
PROVIDER_CACHE_TTL_FIXTURES_SECONDS=7200
PROVIDER_CACHE_TTL_TEAM_STATS_SECONDS=86400
PROVIDER_CACHE_TTL_H2H_SECONDS=86400
PROVIDER_CACHE_TTL_INJURIES_SECONDS=21600
PROVIDER_CACHE_TTL_ODDS_SECONDS=900
PROVIDER_CACHE_TTL_SCORERS_SECONDS=43200
PROVIDER_CACHE_TTL_WEATHER_SECONDS=3600
```

Related (pre-existing): `API_FOOTBALL_KEY`, `FOOTBALL_DATA_API_KEY`,
`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `CRON_SECRET`,
`PROVIDER_MAX_RETRIES`, `PROVIDER_RETRY_BASE_MS`, `PROVIDER_RETRY_MAX_MS`,
`PROVIDER_CIRCUIT_THRESHOLD`, `PROVIDER_CIRCUIT_WINDOW_SECONDS`,
`PROVIDER_CIRCUIT_COOLDOWN_SECONDS`.

---

## 15. Security considerations (Stage 11)

* **Fail closed, not open.** Redis outage ⇒ automated ingestion is blocked
  (limiter unavailable ⇒ no reservations; gate reports Redis unavailable). There
  is no "protection off" mode.
* **No secrets in logs.** Only numeric/state fields are logged.
* **Least data from `/status`.** Account identity (name/email) is never read or
  stored; only plan/quota numerics.
* **Admin-only monitoring.** Protected by existing superadmin authorization.
* **No silent fallback equivalence.** Degraded enrichment is explicitly labelled.
* **Config validated server-side** with per-field fallback; malformed values never
  relax protection.

---

## 16. Tests performed (Stage 10)

New suite [`tests/provider-protection.test.ts`](file:///workspace/tests/provider-protection.test.ts)
(36 tests) covers:

* **Rate limiter:** grant, wait-and-retry, fail-closed on wait exhaustion,
  retry-passes-through-limiter, atomic-result parsing, conservative defaults,
  Redis-unavailable fail-closed.
* **Quota monitoring:** `/status` snapshot, UNKNOWN-never-zero, header fallback,
  70/85/95% thresholds, unknown level, stale snapshot + conservative block,
  stop-threshold block and post-reset allow, unknown-policy control.
* **Failure classification:** fatal auth/invalid-key/quota; recoverable
  rate-limit/server/network/timeout.
* **Single-flight:** hit, miss, concurrent-miss dedup, compare-and-delete release,
  loader-failure-leaves-no-lock, waiter-timeout-no-fabrication, Redis-down runs
  loader directly, non-cacheable results not cached.
* **Cache TTL policy:** per-endpoint TTL selection and ordering.
* **Rate-limit header capture:** documented-only capture, store/read-back,
  no-overwrite-with-empty.
* **Provider metrics:** day-scoped increment/read.
* **Ingestion gate:** ready, Redis-down, stop-threshold, cooldown.
* **Config:** conservative defaults, per-field fallback, documented-env mapping.

Existing suite updated: [`tests/analysis-run.test.ts`](file:///workspace/tests/analysis-run.test.ts)
now supplies the gate's Redis read + a healthy quota snapshot and adds 4 gating
tests (Redis unavailable, unknown quota, stop threshold, circuit cooldown).

**Full suite result:** `479 passed / 5 skipped` (baseline `439 passed / 5
skipped`; +40 provider-protection tests) and `tsc --noEmit` clean. No existing
tests were weakened or assertions removed.

---

## 17. Known limitations (Stage 11)

* **No live provider verification.** No authorized live API-Football/Football-Data
  response was obtained; `/status` field names and header names are
  documentation-verified, not capture-verified. Quota monitoring is exercised
  against mocked responses.
* **Header semantics.** `x-ratelimit-requests-*` values are captured for
  observability and used as a fallback limit/remaining source; if a deployment's
  headers prove to be per-window rather than daily, the derived `consumed` would be
  conservative (may over-warn) rather than permissive.
* **Quota refresh is scheduled externally.** The quota cron route exists but
  scheduling it is a production-configuration step not performed here; until it
  runs, quota stays `UNKNOWN` and ingestion is blocked under the default policy.
* **Monitoring UI not wired.** Only the backend endpoint is delivered.
* **Weather** (Open-Meteo) is not routed through the API-Football limiter.
* **In-memory Redis in dev/test** does not enforce cross-process limits — this is a
  development convenience only; production requires distributed Redis.

---

## 18. Production configuration checklist (Stage 11)

- [ ] Provision `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (production
      REQUIRES distributed Redis; the app throws without it).
- [ ] Set `CRON_SECRET` (≥32 chars).
- [ ] Schedule the provider-quota route (`/api/cron/provider-quota`) to run before
      the daily analysis run, so quota is known and fresh.
- [ ] Confirm `PROVIDER_RPS` / `PROVIDER_RPM` match the account's *safe* budget —
      keep them conservative; do **not** raise them on assumption.
- [ ] Review `PROVIDER_QUOTA_*` thresholds and keep
      `PROVIDER_QUOTA_UNKNOWN_POLICY=block`.
- [ ] Confirm `PROVIDER_QUOTA_FRESHNESS_SECONDS` ≤ the quota-cron interval.
- [ ] Review endpoint TTLs against run cadence.
- [ ] Verify the superadmin monitoring endpoint is reachable and admin-guarded.
- [ ] Run one **manual, authorized** `/status` check to confirm header/field names
      in this environment (do not run a full live ingestion).
- [ ] Confirm previous successful predictions are preserved on a blocked run.

---

*No deployment, commit, push, production cron trigger, full live ingestion, or
production env change was performed as part of this change.*
