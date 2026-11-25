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
| **Internal safety limits** | Self-imposed ceilings that bound **all** traffic regardless of plan, so a burst across concurrent serverless workers cannot exhaust the account. Intentionally more conservative than any paid tier. | `lib/api/provider-config.ts`, env vars `PROVIDER_*` / `FOOTBALL_DATA_*`. | API-Football `PROVIDER_RPS=4`, `PROVIDER_RPM=240`; Football-Data.org `FOOTBALL_DATA_RPS=1`, `FOOTBALL_DATA_RPM=10`. |

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

### 2.2 Mechanism — one atomic Lua reservation (sliding-window log)

> **Hardened (Provider Protection Hardening).** The original implementation used
> two **fixed** epoch-bucketed counters (`INCR` on `…:s:{epochSecond}` /
> `…:m:{epochMinute}`). That permits a boundary burst (e.g. 4 at the end of second
> *N* plus 4 at the start of second *N+1* within a 1-second span). It has been
> **replaced** with a **sliding-window log** — not merely renamed.

Every attempt calls `acquireApiFootballSlot()`
([`lib/api/rate-limiter.ts`](file:///workspace/lib/api/rate-limiter.ts)). It issues
a single Redis `eval` of `SLIDING_WINDOW_LUA` over two sorted sets (per-second and
per-minute). Each granted reservation is a member scored by its timestamp; the
script first evicts members older than the window, then checks the observed count
against the ceiling:

```lua
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - secWin)
redis.call('ZREMRANGEBYSCORE', KEYS[2], 0, now - minWin)
if redis.call('ZCARD', KEYS[1]) >= rps then return {0, waitToOldestSecond} end
if redis.call('ZCARD', KEYS[2]) >= rpm then return {0, waitToOldestMinute} end
redis.call('ZADD', KEYS[1], now, member)
redis.call('ZADD', KEYS[2], now, member)
redis.call('PEXPIRE', KEYS[1], secWin + 1000)
redis.call('PEXPIRE', KEYS[2], minWin + 1000)
return {1, 0}
```

Keys: `provider:rl:api-football:s` and `provider:rl:api-football:m`. Because the
check-and-reserve is a single server-side script, **two workers can never both be
granted the same final slot**, and state survives individual function termination.
`waitMs` on denial is the time until the oldest blocking member leaves its window.

**Guarantees:** atomic Redis-side reservation; correct across serverless instances;
no burst exceeding the configured sustained rate (any 1000 ms window ≤ `rps`, any
60 000 ms window ≤ `rpm`); independent per-second and per-minute ceilings; bounded
waiting; fail-closed on Redis errors or unexpected script replies; every retry
re-reserves a fresh slot. See the hardening report §4 for the full algorithm
discussion and boundary-burst tests.

### 2.2a Independent Football-Data.org limiter

Football-Data.org traffic has its **own** distributed limiter
(`acquireFootballDataSlot()`, keys `provider:rl:football-data:s|m`, metrics
`fd:*`) with **completely independent** limits and configuration
(`FOOTBALL_DATA_RPS/RPM/MAX_WAIT_MS/MAX_SLEEP_MS`). The API-Football limiter is
**not** treated as protection for Football-Data.org, and a change to one never
affects the other. Defaults are pinned to the **documented Free-plan ceiling**
(10 requests/minute) because the account's paid entitlement is **not verified**.

### 2.3 Required behaviour implemented

1. Check the shared limiter (count the sliding window) — inside the Lua script.
2. Reserve capacity atomically (single `eval`, no read-then-write race).
3. If the permitted rate is reached, **wait** (`min(max(waitMs,50), maxSleepMs)`)
   and re-check, up to `PROVIDER_MAX_WAIT_MS`.
4. If a slot still cannot be obtained within the bounded wait, **fail closed** by
   throwing `ProviderProtectionError` (a non-recoverable `ProviderError`). It does
   **not** proceed without a slot.
5. Only after a successful reservation does the HTTP request execute.

### 2.4 Redis failure behaviour

`reserveWithRedis` wraps the reservation: any Redis error, or an unexpected
(not `[allowed, waitMs]`) script reply, throws `ProviderProtectionError`
("rate limiter unavailable / unexpected response") — it is **not** treated as
allowed. There is **no** code path that bypasses the distributed limiter on a Redis
outage, for automated *or* manual operations. The **same** fail-closed policy
applies to both the API-Football and Football-Data.org limiters.

### 2.5 Configuration (no code change required)

Limits are read from validated env through
[`lib/api/provider-config.ts`](file:///workspace/lib/api/provider-config.ts):

| Env var | Field | Default |
| --- | --- | --- |
| `PROVIDER_RPS` | requests / second (API-Football) | `4` |
| `PROVIDER_RPM` | requests / minute (API-Football) | `240` |
| `PROVIDER_MAX_WAIT_MS` | max total wait for a slot | `10000` |
| `PROVIDER_MAX_SLEEP_MS` | max single sleep between re-checks | `1000` |
| `FOOTBALL_DATA_RPS` | requests / second (Football-Data.org) | `1` |
| `FOOTBALL_DATA_RPM` | requests / minute (Football-Data.org) | `10` |
| `FOOTBALL_DATA_MAX_WAIT_MS` | max total wait for a slot | `10000` |
| `FOOTBALL_DATA_MAX_SLEEP_MS` | max single sleep between re-checks | `1000` |

Each field parses independently and falls back to its conservative default if
malformed, so a single bad value cannot crash the runtime or drop the other
settings.

---

## 3. Configured request limits (Stage 2, hardened)

| Limit | Value | Nature |
| --- | --- | --- |
| API-Football per second | **4** | Internal safety limit |
| API-Football per minute | **240** | Internal safety limit |
| Football-Data.org per second | **1** | Internal safety limit |
| Football-Data.org per minute | **10** | Documented Free-plan ceiling (conservative default) |

These bound **all** provider traffic including retries, across **all** serverless
instances. They are intentionally conservative and are **not** derived from, nor a
claim about, the provider's published plan capacity. For context only, API-Football's
*documented plan examples* describe much higher per-minute/second ceilings on paid
tiers (e.g. Pro ≈ 300/min or 5/s; Ultra ≈ 450/min or 7/s; Mega ≈ 900/min or 15/s)
and a free tier of ~100 requests/day — **we do not rely on those numbers** and never
raise our limits on that basis. Football-Data.org's Free tier is documented at
**10 requests/minute**; our defaults match that ceiling.

---

## 4. Redis coordination mechanism (Stage 2/5)

* Client: [`lib/redis.ts`](file:///workspace/lib/redis.ts) — a lazy Proxy singleton.
* Production **requires** a distributed Redis (`UPSTASH_REDIS_REST_URL` /
  `UPSTASH_REDIS_REST_TOKEN`); if absent it throws rather than silently using an
  in-memory store. In dev/test it falls back to a process-local stub.
* Atomic operations used: `eval`/`evalsha` (limiter reservation + single-flight
  lock release), `set … NX EX`, `incr`, `get`, `del`.
* Rate-limit reservations use a **sliding-window log** (`ZREMRANGEBYSCORE` /
  `ZCARD` / `ZADD` / `PEXPIRE` over two sorted sets) inside one atomic Lua script
  — one set per provider per window. No fixed-window `INCR` counters remain.
* Single-flight locks use `SET key token NX EX <ttl>` and compare-and-delete
  release (§9).

---

## 5. Quota monitoring source and verified response fields (Stage 3)

Implemented in [`lib/api/quota.ts`](file:///workspace/lib/api/quota.ts) and
[`lib/api/rate-limit-headers.ts`](file:///workspace/lib/api/rate-limit-headers.ts).

**Verified sources only** (no invented field names). API-Football exposes **two
independent measurement windows** and they are kept strictly separate:

1. **`/status` endpoint** (documented not to count against the daily quota):
   * `response.requests.current` → requests consumed today.
   * `response.requests.limit_day` → daily allocation.
   * `response.subscription.{plan,end,active}` → plan metadata (no account
     identity is ever read or stored).
2. **Response headers** — two **separate** documented windows:
   * **DAILY:** `x-ratelimit-requests-limit`, `x-ratelimit-requests-remaining`.
   * **PER-MINUTE:** `X-RateLimit-Limit`, `X-RateLimit-Remaining`.

**Hardened (Provider Protection Hardening):** the earlier snapshot **mixed** the
`/status` body daily fields with the daily header pair (e.g. `limit` from `/status`,
`remaining` from a header), producing an internally inconsistent snapshot
(`remaining` that contradicted `limit − consumed`). `buildQuotaSnapshot` now picks
**exactly one daily source** — `/status` takes precedence, else the DAILY header
pair, else `unknown` — and derives `remaining`/`consumed` consistently within that
single source. **A per-minute header is never used to compute daily consumption.**

**Snapshot** (`provider:quota:api-football`, TTL `PROVIDER_QUOTA_SNAPSHOT_TTL_SECONDS`).
**Every numeric value records the exact place it came from** (per-value `*Source`):

| Field | Notes |
| --- | --- |
| `provider` | `api-football` |
| `plan`, `subscriptionEnd` | from `/status` subscription (optional) |
| `dailyLimit` | daily window only: `requests.limit_day`, else the DAILY header limit, else `null` |
| `dailyLimitSource` | `PROVIDER_STATUS` / `DAILY_RESPONSE_HEADERS` / `UNKNOWN` |
| `consumed` | daily window only: `requests.current`, else `dailyLimit − dailyRemaining`, else `null` |
| `consumedSource` | `PROVIDER_STATUS` (from `/status`) / `INTERNAL_ESTIMATE` (derived) / `UNKNOWN` |
| `remaining` | daily window only: `dailyLimit − consumed`, or the DAILY header remaining, else `null` |
| `remainingSource` | `DAILY_RESPONSE_HEADERS` / `INTERNAL_ESTIMATE` (derived from `/status`) / `UNKNOWN` |
| `perMinuteLimit` | per-minute window only: `X-RateLimit-Limit`, else `null` |
| `perMinuteLimitSource` | `MINUTE_RATE_HEADERS` / `UNKNOWN` |
| `perMinuteRemaining` | per-minute window only: `X-RateLimit-Remaining`, else `null` |
| `perMinuteRemainingSource` | `MINUTE_RATE_HEADERS` / `UNKNOWN` |
| `lastCheckedAt` | ISO time of the check |
| `status` | `OK` / `STALE` / `UNKNOWN` |
| `source` | overall daily source: `PROVIDER_STATUS` / `DAILY_RESPONSE_HEADERS` / `UNKNOWN` |

**Source vocabulary** (never mixed across windows):

| Label | Meaning |
| --- | --- |
| `PROVIDER_STATUS` | read directly from the `/status` body (`response.requests.current` / `limit_day`) |
| `DAILY_RESPONSE_HEADERS` | read directly from the DAILY header pair (`x-ratelimit-requests-*`) |
| `MINUTE_RATE_HEADERS` | read directly from the PER-MINUTE header pair (`X-RateLimit-*`) |
| `INTERNAL_ESTIMATE` | derived from other verified values **within the same window** (e.g. `limit_day − current`) |
| `UNKNOWN` | no verified value available (never zero) |

**Never assume an unavailable value is zero.** Missing values are `null`; if the
daily window cannot be established (`limit` or `consumed` unknown) `status` stays
`UNKNOWN`. Old snapshots are re-labelled `STALE` by `getProviderQuota` when older
than `PROVIDER_QUOTA_FRESHNESS_SECONDS`. A **newer valid snapshot is never
overwritten** by an older or incomplete refresh (refuse-to-downgrade guard), and
an out-of-order header capture is ignored entirely.

Refresh is performed by a **dedicated** route
([`app/api/cron/provider-quota/route.ts`](file:///workspace/app/api/cron/provider-quota/route.ts))
so the daily analysis run never performs a live quota refresh inline. A best-effort
Redis **lease** (`provider:quota:refresh:lease`, `SET NX EX`) de-duplicates
overlapping refreshes. The superadmin monitoring endpoint can also refresh on
demand (`?refresh=1`). Every refresh and its success/failure is recorded
(`quota:refreshSuccess` / `quota:refreshFailure` / `quota:refreshSkipped`). Both
paths go through the global limiter.

> **Note (verified vs. unverified):** the `/status` field names and header names
> above are taken from the provider's documentation. **No authorized live `/status`
> response was obtained in this change**, so the field names are
> documentation-verified, not capture-verified.
>
> **Quota-mapping verification.** Covered by
> [`tests/quota-mapping-verification.test.ts`](file:///workspace/tests/quota-mapping-verification.test.ts)
> (MOCK-VERIFIED/CALCULATED): the documented `/status` example maps to
> `PROVIDER_STATUS`; the DAILY header pair maps to `DAILY_RESPONSE_HEADERS`; the
> per-minute pair maps to `MINUTE_RATE_HEADERS`; derived values are
> `INTERNAL_ESTIMATE`; missing/partial/contradictory/zero/stale cases are asserted;
> and `/status` is shown to pass through the distributed limiter yet not to consume
> daily quota. Live account quota, subscription entitlement and the real header
> names remain **NOT VERIFIED** until an authorized live probe is run.

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
  rethrows non-recoverable errors immediately (no retry, no retry storm). A single
  retry is never scheduled twice for the same attempt.
* **Recoverable:** exponential backoff with a hard cap (`PROVIDER_MAX_RETRIES`
  default 2, `PROVIDER_RETRY_BASE_MS`, `PROVIDER_RETRY_MAX_MS`).
* **`Retry-After` (hardened):** `parseRetryAfter` accepts **both** documented
  formats — an integer (or fractional) number of seconds **and** an HTTP date —
  and safely rejects malformed, empty or negative values (falls back to backoff).
  When present, the provider's delay is honoured **in full**: it is **never
  shortened to retry early**. If the requested delay would exceed the remaining
  execution budget (`budgetMs`/`deadline`), the attempt is **abandoned** rather than
  retried early; the caller fails or defers safely.
* **Every retry passes through the correct provider-specific limiter** — the retry
  attempt function calls the relevant `acquire…Slot()`, so a retry cannot bypass
  rate control or concurrency controls and always reserves a **fresh** slot.
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

#### 9.1 Redis-outage policy (hardened)

Single-flight locking needs Redis. When Redis is unavailable for the lock
operation, two policies exist (`outagePolicy`):

* **`fail-closed` (the default for automated ingestion via
  `cachedProviderFetch`):** the fetch is **refused** with `SingleFlightError`
  instead of running the loader unguarded. Rationale: without a shared lock an
  uncontrolled number of concurrent workers could each issue the *same* provider
  request (a thundering herd), and on a cold cache that both wastes quota and can
  trip provider limits. Failing closed keeps the provider protection intact.
* **`degrade` (explicit, observable):** the loader runs directly. This is
  **observable** (`singleFlight:lockUnavailable` + a `provider.…lockUnavailable`
  log) and is **never** a silent path. The **global distributed limiter remains
  mandatory and is never weakened** to make single-flight "work": every outbound
  request still reserves a provider slot, so degraded mode is bounded by the
  provider rate limit even though duplicate in-flight requests are not collapsed.

There is **no** path that fabricates a cache result.

Safety properties:

* **Unique ownership token** (`randomUUID`) per acquisition.
* **Safe release**: `RELEASE_LOCK_LUA` compare-and-delete — a previous owner can
  never delete a lock it no longer holds (e.g. after TTL expiry + re-acquire).
* **Bounded wait** and **lock TTL** (`PROVIDER_SINGLE_FLIGHT_LOCK_TTL_MS` default
  15000, wait 18000) sized to exceed normal provider latency.
* **No permanent locks**: the owner releases in a `finally`, even if the loader
  throws.
* **Loader failure** propagates to the owner; waiters get a clear
  failure/timeout, not an invented success (`singleFlight:failed` metric).

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
* The daily run is bounded by an explicit **execution-time budget**
  (`PROVIDER_ANALYSIS_MAX_RUNTIME_MS`, default 240 000 ms — below the route's
  `maxDuration` of 300 s) rather than relying on individual waits being bounded.
  Ingestion is **batched** (`PROVIDER_ANALYSIS_BATCH_SIZE`, default 25 fixtures
  per durable transaction). When the budget is reached mid-run the remainder is
  **deferred idempotently** to the next invocation — the fixture list is never
  silently truncated, no partial run is marked `completed`, and already-persisted
  fixtures are skipped on resume. See document hardening §8 for the runtime
  calculation and the resumable-run design.

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
`provider.ingestionGate`, and
`analysis.run.{started,resumed,completed,failed,blocked,deferred,budget}`.

### 13.2 Day-scoped metrics (`lib/api/provider-metrics.ts`)

Counters in Redis (`provider:metrics:{day}:{name}`, 7-day TTL). Providers are
tracked **separately** (`af:*` = API-Football, `fd:*` = Football-Data.org):

* **Per provider:** `httpRequests` (actual outbound HTTP attempts — **not** logical
  fetches, **not** cache hits), `success`, `failed`, `429`, `authFailures`,
  `quotaFailures`, `rateLimitWait`, `rateLimitDenied`, `fallbackActivated`.
* **Cache (provider-agnostic):** `cache:hit`, `cache:miss`, `cache:readFailure`,
  `cache:writeFailure`.
* **Single-flight:** `singleFlight:lockAcquired`, `singleFlight:contended`,
  `singleFlight:lockUnavailable`, `singleFlight:waiterTimeout`,
  `singleFlight:failed`.
* **Operational:** `quota:refreshSuccess`, `quota:refreshFailure`,
  `quota:refreshSkipped`, `ingestion:completed`, `ingestion:deferred`,
  `ingestion:blocked`.
* **Legacy aliases** (retained, see below): `provider:requests`,
  `provider:rateLimitWait`.

**A cache hit is never counted as a provider request** — only the HTTP choke-point
increments `af:httpRequests` / `fd:httpRequests`. Missing counters read as `0`
(never fabricated non-zero). No counter key or field is derived from a secret.

### 13.3 Admin visibility

`GET /api/superadmin/analysis/provider-status`
([route](file:///workspace/app/api/superadmin/analysis/provider-status/route.ts))
guarded by the **existing** `requireAnalysisAdmin` authorization; never exposed to
ordinary users. Returns: API-Football daily quota + per-minute rate information,
quota freshness, internal rate-limit config, **Football-Data.org limiter status**,
provider-scoped counters (`metrics.apiFootball` / `metrics.footballData`),
rate-limit waits/denials, cache effectiveness, single-flight contention, circuit
states, threshold config, and the last ingestion run (including its
`blockedReason`). `?refresh=1` re-polls `/status` (through the limiter); that is the
only provider request here. No secret is ever included in the payload.

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
and typed in [`lib/env.ts`](file:///workspace/lib/env.ts) and
[`lib/api/provider-config.ts`](file:///workspace/lib/api/provider-config.ts).

```
# --- API-Football distributed rate limiter ---
PROVIDER_RPS=4
PROVIDER_RPM=240
PROVIDER_MAX_WAIT_MS=10000
PROVIDER_MAX_SLEEP_MS=1000

# --- Football-Data.org distributed rate limiter (independent) ---
FOOTBALL_DATA_RPS=1
FOOTBALL_DATA_RPM=10
FOOTBALL_DATA_MAX_WAIT_MS=10000
FOOTBALL_DATA_MAX_SLEEP_MS=1000

# --- Daily quota limits (internal safety caps) ---
FOOTBALL_API_DAILY_LIMIT=1000
FOOTBALL_DATA_DAILY_LIMIT=100

# --- Daily-quota consumption thresholds (ratio 0..1) ---
PROVIDER_QUOTA_WARNING_THRESHOLD=0.7
PROVIDER_QUOTA_CRITICAL_THRESHOLD=0.85
PROVIDER_QUOTA_STOP_THRESHOLD=0.95
PROVIDER_QUOTA_FRESHNESS_SECONDS=1800
PROVIDER_QUOTA_SNAPSHOT_TTL_SECONDS=86400
PROVIDER_QUOTA_UNKNOWN_POLICY=block

# --- Execution-time budget for the daily analysis run ---
PROVIDER_ENRICHMENT_CONCURRENCY=10
PROVIDER_ANALYSIS_MAX_RUNTIME_MS=240000
PROVIDER_ANALYSIS_BATCH_SIZE=25
ANALYSIS_MAX_ATTEMPTS=3

# --- Distributed single-flight cache lock ---
PROVIDER_SINGLE_FLIGHT_LOCK_TTL_MS=15000
PROVIDER_SINGLE_FLIGHT_WAIT_MS=18000
PROVIDER_SINGLE_FLIGHT_POLL_MS=150

# --- Endpoint-specific cache TTLs (seconds) ---
PROVIDER_CACHE_TTL_DEFAULT_SECONDS=86400
PROVIDER_CACHE_TTL_FIXTURES_SECONDS=7200
PROVIDER_CACHE_TTL_TEAM_STATS_SECONDS=86400
PROVIDER_CACHE_TTL_H2H_SECONDS=86400
PROVIDER_CACHE_TTL_INJURIES_SECONDS=21600
PROVIDER_CACHE_TTL_ODDS_SECONDS=900
PROVIDER_CACHE_TTL_SCORERS_SECONDS=43200
PROVIDER_CACHE_TTL_WEATHER_SECONDS=3600

# --- Circuit breaker (existing) ---
PROVIDER_CIRCUIT_THRESHOLD=5
PROVIDER_CIRCUIT_WINDOW_SECONDS=120
PROVIDER_CIRCUIT_COOLDOWN_SECONDS=60

# --- Bounded retry (existing) ---
PROVIDER_MAX_RETRIES=2
PROVIDER_RETRY_BASE_MS=500
PROVIDER_RETRY_MAX_MS=8000
```

Related (pre-existing): `API_FOOTBALL_KEY`, `FOOTBALL_DATA_API_KEY`,
`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `CRON_SECRET`.

| Env var | Purpose | Default | Allowed range | Required | Safe in prod? |
| --- | --- | --- | --- | --- | --- |
| `PROVIDER_RPS` | API-Football requests per second (internal safety limit, shared across workers) | `4` | positive int | no | yes |
| `PROVIDER_RPM` | API-Football requests per minute (internal safety limit) | `240` | positive int | no | yes |
| `PROVIDER_MAX_WAIT_MS` | Max total ms to wait for a rate-limit slot before failing closed | `10000` | positive int | no | yes |
| `PROVIDER_MAX_SLEEP_MS` | Max single sleep ms between rate-limit re-checks | `1000` | positive int | no | yes |
| `FOOTBALL_DATA_RPS` | Football-Data.org requests per second (internal safety limit) | `1` | positive int | no | yes |
| `FOOTBALL_DATA_RPM` | Football-Data.org requests per minute (pinned to free-plan ceiling) | `10` | positive int | no | yes |
| `FOOTBALL_DATA_MAX_WAIT_MS` | Max total ms to wait for a Football-Data slot | `10000` | positive int | no | yes |
| `FOOTBALL_DATA_MAX_SLEEP_MS` | Max single sleep ms for Football-Data re-checks | `1000` | positive int | no | yes |
| `FOOTBALL_API_DAILY_LIMIT` | Internal daily quota cap for API-Football (requests/day) | `1000` | positive int | no | yes — configure per subscription |
| `FOOTBALL_DATA_DAILY_LIMIT` | Internal daily quota cap for Football-Data.org (requests/day) | `100` | positive int | no | yes — configure per subscription |
| `PROVIDER_QUOTA_WARNING_THRESHOLD` | Consumed/dailyLimit ratio that triggers a warning (0..1) | `0.7` | 0 < x <= 1 | no | yes |
| `PROVIDER_QUOTA_CRITICAL_THRESHOLD` | Consumed/dailyLimit ratio that triggers a critical warning (0..1) | `0.85` | 0 < x <= 1 | no | yes |
| `PROVIDER_QUOTA_STOP_THRESHOLD` | Consumed/dailyLimit ratio that blocks new ingestion (0..1) | `0.95` | 0 < x <= 1 | no | yes |
| `PROVIDER_QUOTA_FRESHNESS_SECONDS` | Max age (s) of a quota snapshot before it is treated STALE | `1800` | positive int | no | yes |
| `PROVIDER_QUOTA_SNAPSHOT_TTL_SECONDS` | Redis TTL (s) for the stored quota snapshot | `86400` | positive int | no | yes |
| `PROVIDER_QUOTA_UNKNOWN_POLICY` | Behaviour when quota cannot be determined: `block` (fail closed) or `warn` | `block` | `block` \| `warn` | no | yes — keep `block` |
| `PROVIDER_ENRICHMENT_CONCURRENCY` | Max concurrent fixtures during enrichment (bounded by global limiter) | `10` | 1..20 | no | yes |
| `PROVIDER_ANALYSIS_MAX_RUNTIME_MS` | Wall-clock ceiling (ms) for a single analysis invocation before checkpoint+defer | `240000` | positive int | no | yes — keep below route maxDuration |
| `PROVIDER_ANALYSIS_BATCH_SIZE` | Fixtures per durable, idempotent ingestion batch | `25` | 1..500 | no | yes |
| `ANALYSIS_MAX_ATTEMPTS` | Max analysis attempts per fixture before exclusion | `3` | positive int | no | yes |
| `PROVIDER_SINGLE_FLIGHT_LOCK_TTL_MS` | Redis lock TTL (ms) for single-flight cache locks | `15000` | positive int | no | yes |
| `PROVIDER_SINGLE_FLIGHT_WAIT_MS` | Max wait (ms) for a non-owner worker on a single-flight lock | `18000` | positive int | no | yes |
| `PROVIDER_SINGLE_FLIGHT_POLL_MS` | Poll interval (ms) for single-flight lock waiters | `150` | positive int | no | yes |
| `PROVIDER_CACHE_TTL_DEFAULT_SECONDS` | Default cache TTL (s) for keys with no specific rule | `86400` | positive int | no | yes |
| `PROVIDER_CACHE_TTL_FIXTURES_SECONDS` | Cache TTL (s) for fixture data | `7200` | positive int | no | yes |
| `PROVIDER_CACHE_TTL_TEAM_STATS_SECONDS` | Cache TTL (s) for team statistics / standings | `86400` | positive int | no | yes |
| `PROVIDER_CACHE_TTL_H2H_SECONDS` | Cache TTL (s) for head-to-head history | `86400` | positive int | no | yes |
| `PROVIDER_CACHE_TTL_INJURIES_SECONDS` | Cache TTL (s) for injuries data | `21600` | positive int | no | yes |
| `PROVIDER_CACHE_TTL_ODDS_SECONDS` | Cache TTL (s) for odds data | `900` | positive int | no | yes |
| `PROVIDER_CACHE_TTL_SCORERS_SECONDS` | Cache TTL (s) for top scorers | `43200` | positive int | no | yes |
| `PROVIDER_CACHE_TTL_WEATHER_SECONDS` | Cache TTL (s) for weather forecast | `3600` | positive int | no | yes |
| `PROVIDER_CIRCUIT_THRESHOLD` | Circuit-breaker failure threshold (failures per window) | `5` | positive int | no | yes |
| `PROVIDER_CIRCUIT_WINDOW_SECONDS` | Circuit-breaker failure window (s) | `120` | positive int | no | yes |
| `PROVIDER_CIRCUIT_COOLDOWN_SECONDS` | Circuit-breaker cooldown (s) once open | `60` | positive int | no | yes |
| `PROVIDER_MAX_RETRIES` | Max additional retry attempts after the first attempt | `2` | 0..5 | no | yes |
| `PROVIDER_RETRY_BASE_MS` | Base exponential backoff (ms) for retries | `500` | positive int | no | yes |
| `PROVIDER_RETRY_MAX_MS` | Max single backoff (ms), never applied to Retry-After | `8000` | positive int | no | yes |
| `API_FOOTBALL_KEY` | API-Football bearer key (`x-apisports-key` header) | (none) | non-empty string | yes (for API-Football) | no — real secret |
| `FOOTBALL_DATA_API_KEY` | Football-Data.org bearer key (`X-Auth-Token` header) | (none) | non-empty string | yes (for Football-Data) | no — real secret |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL (production REQUIRED) | (none) | URL | no (dev/test), yes (prod) | no — real secret |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token | (none) | non-empty string | no (dev/test), yes (prod) | no — real secret |
| `CRON_SECRET` | Secret enforced by `/api/cron/provider-quota` and `/api/cron/daily-analysis` | (none) | >= 32 chars | yes (prod) | no — real secret |

Notes:

* **Internal safety limits** (`PROVIDER_*`, `FOOTBALL_DATA_*`) are **not** claims about provider entitlement. They are intentionally conservative ceilings that bound all traffic across every serverless instance so a burst cannot exhaust the account. They only change through validated server-side env vars; malformed values fall back to conservative defaults and never relax protection.
* **Daily quota limits** (`FOOTBALL_API_DAILY_LIMIT`, `FOOTBALL_DATA_DAILY_LIMIT`) are internal safety caps, not provider-documented entitlements. The operator must set them per subscription; defaults shown are conservative internal caps.
* **`PROVIDER_QUOTA_UNKNOWN_POLICY=block`** is the fail-closed default; changing to `warn` lets ingestion proceed when quota cannot be confirmed, which is less safe.
* **`PROVIDER_ANALYSIS_MAX_RUNTIME_MS`** must sit comfortably **below** the analysis route's `maxDuration` (300 s) to leave a safety margin for checkpoint+defer.
* Real secrets (`*_KEY`, `UPSTASH_REDIS_*`, `CRON_SECRET`) are intentionally left empty in `.env.example` and must never be committed.

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

## 16. Tests performed (Stage 10 + hardening)

Two suites now cover the provider-protection layer:

* [`tests/provider-protection.test.ts`](file:///workspace/tests/provider-protection.test.ts)
  — the original 40 tests (rate limiter grant/wait/fail-closed/atomic parsing;
  quota snapshot / UNKNOWN-never-zero / thresholds / stale; failure classification;
  single-flight; cache TTL policy; header capture; metrics; ingestion gate; config).
* [`tests/provider-hardening.test.ts`](file:///workspace/tests/provider-hardening.test.ts)
  — the hardening regressions:
  * **§3 sliding window:** Lua shape (sorted-set log, no `INCR`); **second-boundary
    burst** and **minute-boundary burst** suppressed; **simultaneous reservations**
    (never over-grants the final slot); sequential pacing; atomic-result parsing;
    fail-closed on Redis error and on an unexpected reply.
  * **§2 Football-Data.org:** independent key prefix, separate limits, env
    independence, retry-reservation, 429/auth/quota classification.
  * **§4 quota:** daily+per-minute from `/status`+headers without mixing; DAILY
    header fallback; **per-minute never feeds daily**; partial pair ⇒ `UNKNOWN`;
    70/85/95% thresholds; `STALE`; out-of-order header ignored; capture.
  * **§4/§8 refresh guards:** refresh+store; refuse newer-overwrite; refuse
    valid→UNKNOWN overwrite; lease de-dup; failed refresh throws.
  * **§5 Retry-After:** integer/fractional/HTTP-date/malformed/negative/empty;
    delay honoured in full (short and long); budget-exceeded abandons; no
    auth/quota retry; no retry storm.
  * **§6 execution estimator:** 48-fixture worst case (288 logical / 80 000 ms),
    retry-heavy (864 / 221 000 ms), rpm-bound; 400 fixtures exceed budget;
    `createRunBudget`.
  * **§7 single-flight:** read-failure ⇒ miss; fail-closed; concurrent misses;
    safe release; waiter takeover after lock expiry; waiter timeout.
  * **§9 metrics:** af/fd separation; a cache hit is not a provider request;
    missing ⇒ 0; no secret leakage.
  * **§8/§10 security:** provider-quota cron 401/200 + non-secret payload;
    daily-analysis cron 401; provider-status 403 non-superadmin, 200 superadmin
    payload with quota/footballDataLimiter/cache/singleFlight/circuits/metrics and
    no secrets.

  Plus [`tests/analysis-run.test.ts`](file:///workspace/tests/analysis-run.test.ts)
  gained the §6 **defer** and **resume/skip-already-persisted** tests (no partial
  success; no duplicate predictions).

**Full suite result:** `542 passed / 5 skipped` (up from `479 passed / 5 skipped`)
and `tsc --noEmit` clean. No existing tests were weakened or assertions removed.
All provider tests are **MOCK-VERIFIED / CALCULATED** — they do **not** prove live
provider behaviour.

---

## 17. Known limitations (Stage 11)

* **No live provider verification.** No authorized live API-Football/Football-Data
  response was obtained; `/status` field names and header names are
  documentation-verified, not capture-verified. Quota monitoring is exercised
  against mocked responses.
* **Header semantics (hardened).** The DAILY
  (`x-ratelimit-requests-*`) and PER-MINUTE (`X-RateLimit-*`) header pairs are now
  stored as **separate** fields and never combined; daily consumption can never be
  derived from a per-minute header. If a deployment's daily headers prove to carry
  a different window than documented, the derived `consumed` stays conservative
  (may over-warn) rather than permissive.
* **Football-Data.org paid entitlement not verified.** Its limiter defaults to the
  documented Free-plan ceiling (10 req/min). Raising it requires an authorized live
  probe confirming the entitlement.
* **Quota refresh is scheduled externally.** The quota cron route exists but
  scheduling it is a production-configuration step not performed here; until it
  runs, quota stays `UNKNOWN` and ingestion is blocked under the default policy.
  The **required order** is: refresh quota → confirm fresh/valid → evaluate gate →
  run analysis (see §18).
* **Monitoring UI not wired.** Only the backend endpoint is delivered.
* **Weather** (Open-Meteo) is not routed through the API-Football limiter (no
  change made — no existing safety issue was identified there).
* **In-memory Redis in dev/test** does not enforce cross-process limits — this is a
  development convenience only; production requires distributed Redis.
* **Multi-invocation resume.** A deferred run completes across **repeated
  invocations** of the daily cron. A single invocation is **not** guaranteed to
  process the entire 48-hour fixture set; the remainder is deferred and resumed
  idempotently (never a partial-run "success").

---

## 18. Production configuration checklist (Stage 11)

- [ ] Provision `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (production
      REQUIRES distributed Redis; the app throws without it).
- [ ] Set `CRON_SECRET` (≥32 chars). **Both** `/api/cron/provider-quota` and
      `/api/cron/daily-analysis` enforce it.
- [ ] **Schedule the required cron order:** run `/api/cron/provider-quota` **before**
      `/api/cron/daily-analysis` (e.g. quota at `0 5 * * *`, analysis at `0 6 * * *`),
      so quota is known, valid and fresh before the gate is evaluated.
- [ ] Confirm `PROVIDER_RPS` / `PROVIDER_RPM` match the account's *safe* budget —
      keep them conservative; do **not** raise them on assumption.
- [ ] Confirm `FOOTBALL_DATA_RPS` / `FOOTBALL_DATA_RPM` (default Free-plan ceiling
      1/s, 10/min) — raise only after an authorized live probe of the entitlement.
- [ ] Review `PROVIDER_QUOTA_*` thresholds and keep
      `PROVIDER_QUOTA_UNKNOWN_POLICY=block`.
- [ ] Confirm `PROVIDER_QUOTA_FRESHNESS_SECONDS` ≤ the quota-cron interval.
- [ ] Confirm `PROVIDER_ANALYSIS_MAX_RUNTIME_MS` sits comfortably **below** the
      analysis route's `maxDuration` (300 s), leaving a safety margin.
- [ ] Review endpoint TTLs against run cadence.
- [ ] Verify the superadmin monitoring endpoint is reachable and admin-guarded.
- [ ] Run one **manual, authorized** `/status` check to confirm header/field names
      in this environment (do not run a full live ingestion).
- [ ] Confirm previous successful predictions are preserved on a blocked/deferred run.

---

*No deployment, commit, push, production cron trigger, full live ingestion, or
production env change was performed as part of this change. The hardening report
is [`docs/PREDICTPRO_PHASE_1_PROVIDER_PROTECTION_HARDENING.md`](file:///workspace/docs/PREDICTPRO_PHASE_1_PROVIDER_PROTECTION_HARDENING.md).*
