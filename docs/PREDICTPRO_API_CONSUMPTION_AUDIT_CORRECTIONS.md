# PredictPro — API Consumption Audit: Calculation Verification (Corrections)

- **Document type:** Independent, read-only **verification/correction** of `docs/PREDICTPRO_API_CONSUMPTION_AUDIT.md`
- **Date:** 2026-11-22
- **Roles:** Principal Backend Engineer · API Integration Specialist · Production Reliability Auditor
- **Repository:** `Kelly883/Prediction-claude-` — branch `trae/agent-4phDPY`
- **Modification during this review:** **None.** No application code, configuration, dependencies, database records, or production services were changed. No cron job was triggered. No live provider request was made. No secret was read or printed. This report (`docs/PREDICTPRO_API_CONSUMPTION_AUDIT_CORRECTIONS.md`) is the only file created.
- **Companion document under review:** `docs/PREDICTPRO_API_CONSUMPTION_AUDIT.md` (referenced below as "the original audit").

> **Evidence legend**
> - **[VERIFIED]** — read directly from source code or an official provider page (URL cited).
> - **[CALCULATED]** — arithmetic derived strictly from the code's call structure.
> - **[ESTIMATED]** — depends on an unmeasured assumption (fixture distribution, retry rate, cache survival). Each assumption is named.
> - **[NOT MEASURED]** — requires a live API key / real counters; **none exist for this codebase at the time of writing**.
> - **[FLAGGED]** — a claim that could **not** be substantiated by the available evidence.

> **Central instruction of this review, honoured throughout:** *caching is not assumed to work*, and *a shared cache key does **not** prevent concurrent duplicate requests*. Every count below is tied to the actual key/TTL/lookup code path.

---

## 1. Executive summary — what the original audit got right, and what it understated

**Confirmed correct in the original audit [VERIFIED]**
- API-Football is the only live provider on the primary path; all six endpoints originate from `lib/api/football-api.ts`.
- Fixture discovery is one request per league (`/fixtures`), **not** one per fixture.
- `cachedProviderFetch` has **no in-flight (single-flight) lock**.
- The Free plan (100 req/day) is unusable for this workload, and Free is season-restricted.
- The Pro plan is the correct **minimum** tier; Pro price $19 / 7,500-per-day is [VERIFIED] against the official pricing page.

**Corrected / material findings [VERIFIED + CALCULATED]**
1. **Top-scorer cost was understated.** The original model counted `S` (≤20, one per active league) scorer requests. Because `fetchScorers()` is called **once per fixture inside a `Promise.all`** while its cache key is **per league-season**, and the cache has **no single-flight lock**, a cold run can issue **up to one scorer request per fixture — i.e. `N`, not `20`.** (Part 1.)
2. **Team-statistics concurrent misses were not counted.** The original model used the *logical* unique count `U`. HTTP-level deduplication can be weaker: on a cold run up to **`2N`** real team-statistics requests can be issued. (Part 2.)
3. **The per-run ceiling is `20 + 6N`, not `40 + 5N`.** The original "theoretical maximum" was **optimistic by up to `N − 20` requests** (≈5% at 30 fixtures → ≈19% at 220 fixtures). (Part 3.)
4. **The concurrency fan-out is `MAX_CONCURRENCY × 6 ≈ 60` simultaneous provider requests, with no provider-wide rate limiter.** On the Pro plan this can exceed the documented **5 requests/second** allowance and trigger **HTTP 429** independently of the daily quota. (Part 6.)
5. **The 35–40% optimisation saving is plausible but not rigorously derived**, and its own components double-count the scorer term; a clean decomposition gives **≈45–50%** of the *cold* baseline from TTL extensions alone — but only if cross-run cache survival actually holds, which is unverified. (Part 4.)

**Bottom line:** the corrected theoretical ceiling is `20 + 6N` (up to ≈1,340/run at 220 fixtures, or ≈4,020/run at 3× retry amplification), which still fits inside the Pro quota (7,500/day) but with **≈1.9× headroom in the absolute worst case, not the "≈5×" the original audit implied.** The **Pro recommendation therefore stands**, with two caveats: (a) the per-minute/429 risk is real and unmitigated by the daily quota, and (b) the app remains quota-blind.

---

## 2. Scope, method, and evidence base

**Read-only review.** Method: static tracing of the ingestion call graph plus arithmetic on the call structure. No live calls were made; `measured` figures are therefore reported as **NOT MEASURED**.

**Code read for this review [VERIFIED]**
- `lib/api/football-api.ts` — `request()`, `fetchApiFootballFixtures`, `fetchApiFootballEnrichment`, `fetchTeamStats`, `fetchH2H`, `fetchInjuries`, `fetchOdds`, `fetchScorers`.
- `lib/analysis/ingestion/cache.ts` — `cachedProviderFetch`, `CACHE_TTL_SECONDS`.
- `lib/analysis/ingestion/enrichment.ts` — `MAX_CONCURRENCY`, `mapWithConcurrency`, `enrichFixtures`.
- `lib/analysis/ingestion/fixtures.ts` — `fetchFixtures`, `getEnabledLeagues`, `dedupeFixtures`, `FIXTURE_WINDOW_HOURS`.
- `lib/api/retry.ts` — `withBoundedRetry`, `providerErrorFromResponse`, `parseRetryAfter`, `DEFAULT_RETRIES`.
- `lib/api/circuit-breaker.ts` — threshold/window/cooldown.
- `lib/redis.ts` — fail-closed behaviour in production.
- `lib/ratelimit.ts` — import sites (repo-wide search).
- `lib/api/provider-mapping.ts` — free-tier season helper.

**Official provider sources [VERIFIED]** (accessed 2026-11-22)
- Pricing: `https://www.api-football.com/pricing/`
- Docs (status endpoint, response headers): `https://www.api-football.com/documentation-v3`
- Rate-limit post: `https://www.api-football.com/news/post/how-ratelimit-works`
- Optimisation/quota post: `https://www.api-football.com/news/post/how-to-optimize-api-sports-calls-and-quota-usage`

---

## 3. Part 1 — Verification of top-scorer request calculations

### 3.1 What the code actually does [VERIFIED]

`fetchApiFootballEnrichment` issues six calls **per fixture**, all started together in one `Promise.all` — [football-api.ts](file:///workspace/lib/api/football-api.ts#L159-L166):

```ts
const [homeStats, awayStats, h2h, injuries, odds, scorers] = await Promise.all([
  safe('home_stats', () => fetchTeamStats(fixture.homeTeamId, fixture.leagueCode, season)),
  safe('away_stats', () => fetchTeamStats(fixture.awayTeamId, fixture.leagueCode, season)),
  safe('h2h',       () => fetchH2H(...)),
  safe('injuries',  () => fetchInjuries(...)),
  safe('odds',      () => fetchOdds(...)),
  safe('scorers',   () => fetchScorers(fixture.leagueCode, season)),   // ← per fixture
]);
```

`fetchScorers` wraps the network call in a **league-season** cache key — [football-api.ts](file:///workspace/lib/api/football-api.ts#L366-L381):

```ts
const payload = await cachedProviderFetch(`api-football:scorers:${leagueId}:${season}`, async () => {
  const result = await request<unknown[]>('/players/topscorers', { league: leagueId, season });
  return result.response ?? [];
});
```

`cachedProviderFetch` is a plain read-through cache with **no in-flight lock** — [cache.ts](file:///workspace/lib/analysis/ingestion/cache.ts#L6-L27):

```ts
cached = await redis.get<T>(key);            // 1. read
if (cached !== null && cached !== undefined) return cached;
const fresh = await loader();                // 2. miss → network call
await redis.set(key, fresh, { ex: CACHE_TTL_SECONDS });   // 3. write
```

Concurrency is 10 fixtures, process-wide — [enrichment.ts](file:///workspace/lib/analysis/ingestion/enrichment.ts#L7-L23):

```ts
const MAX_CONCURRENCY = 10;
// mapWithConcurrency spawns Math.min(limit, items.length) runners that pull
// items in array order from a shared nextIndex.
```

### 3.2 Fixture ordering matters [VERIFIED]

`fetchApiFootballFixtures` builds its result by iterating the league list **in order** and appending each league's fixtures — [football-api.ts](file:///workspace/lib/api/football-api.ts#L91-L121). The league list comes from `getEnabledLeagues()` ordered `priority asc, leagueCode asc` — [fixtures.ts](file:///workspace/lib/analysis/ingestion/fixtures.ts#L21-L27). `dedupeFixtures` is a `filter`, so it **preserves order** — [fixtures.ts](file:///workspace/lib/analysis/ingestion/fixtures.ts#L67-L75).

**Consequence:** the fixture array is **grouped by league**. The 10 runners of `mapWithConcurrency` therefore begin on a block of **same-league** fixtures, so their `fetchScorers` calls for that league fire **near-simultaneously**. Because the shared key is not yet written at cold start, all of them observe a miss.

### 3.3 Realistic vs worst-case scorer requests (cold run)

Let `N` = fixtures, `S` = active leagues (≤ 20), `C` = `MAX_CONCURRENCY` = 10, `k` = fixtures in one league.

| Model | Scorer requests | Rationale |
|---|---|---|
| **Hot cache / logical dedup** (original audit) | **`S` ≤ 20** | One hit per league; assumes every non-first call *reads* a value already written. |
| **Cold, realistic** | **`Σ_leagues min(C, k_league)`**, bounded by `[S, N]` | Each league's first concurrent burst (≤ `C`) each miss; later calls hit once a write has landed. Ordering (grouped by league) makes the first burst land in one league. |
| **Cold, absolute worst** | **`N`** | If no call ever observes a written key before issuing its own (maximum collision), every one of the `N` fixtures issues a request. This is the ceiling because each fixture calls `fetchScorers` exactly once. |
| **With retries** | up to **`3 × the above`** | `withBoundedRetry` allows up to 3 attempts per request (Part 3.4). |

**Verdict on Part 1:** the original report's "≤ once per league (deduped)" is a **logical-deduplication** count. The **HTTP-request** count on a cold run is a different, larger quantity: bounded above by `N` (per attempt). The report's statement that `fetchScorers()` is "invoked per fixture" is correct; its *count* of the resulting requests (`S`) is **not** the cold-run HTTP count.

---

## 4. Part 2 — Verification of team-statistics request calculations

### 4.1 Unique team-season combinations per fixture scenario [VERIFIED + CALCULATED]

Each fixture issues **two** team-statistics calls (home, away) with key `api-football:team-stats:{teamId}:{leagueId}:{season}` — [football-api.ts](file:///workspace/lib/api/football-api.ts#L179-L188).

- **Logical call count:** `2N`.
- **Logical unique team-seasons `U`:** a team-season key repeats only when the *same team* appears in *more than one* fixture **within the 48 h window** — [fixtures.ts](file:///workspace/lib/analysis/ingestion/fixtures.ts#L8). In a 48 h window most clubs play at most once, so `U ≈ 2N − (few repeats)`.
  - **[ESTIMATED] assumption:** `U ≈ 1.9N` (a small ≤5% repeat rate for midweek+weekend congestion). The exact value depends on the real fixture calendar, which is unmeasured.

### 4.2 Logical deduplication vs HTTP request deduplication — the distinction required

| Layer | What it deduplicates | Team-stats effect on a cold run |
|---|---|---|
| **Logical deduplication** | The *intent* to fetch a given team-season twice | Would yield `U ≈ 1.9N` requests **if** the second caller always observed the first caller's write |
| **HTTP request deduplication** | Ensuring two callers share one in-flight network call | **Not implemented.** `cachedProviderFetch` has no single-flight lock, so it deduplicates only what is **already written to Redis at read time** |

Because writes happen only *after* the loader resolves, two callers that `get` before either `set` both proceed to the network call.

### 4.3 Additional requests caused by concurrent cache misses (cold run)

- A team-season key is consumed by as many fixtures as involve that team. With ~1 fixture/team in 48 h, most keys are consumed **once** → little duplication from team-stats on a realistic cold run **[ESTIMATED]**.
- The **hard ceiling** is `2N`: if no call observes a prior write, each of the `2N` team-slot calls issues a request **[CALCULATED]**.
- Retries multiply this by up to **3×** (Part 3.4).

**Verdict on Part 2:** the original audit's team-statistics figure (`U`) is the **logical** count and is a **reasonable realistic estimate**, but it is **not a strict HTTP bound**. The strict cold-run ceiling is `2N` per attempt. The report's duplicate-analysis note ("up to concurrency − 1 = 9 duplicates per shared team-season") is directionally correct and is the honest HTTP-level caveat.

---

## 5. Part 3 — Recalculated total consumption (30 / 50 / 100 / 150 / 220 fixtures)

### 5.1 Corrected formula

```
Cold run, single attempt:
  R_ceiling = 20 (discovery)  + 2N (team-stats ceiling) + N (h2h) + N (injuries) + N (odds) + N (scorers ceiling)
            = 20 + 6N

Realistic cold run:
  R_real    = 20 + U (≈1.9N) + N + N + N + min(N, 10·S)
            ≈ 20 + 4.9N + min(N, 200)          [ESTIMATED]

Original audit model (logical dedup, scorers = S):
  R_orig    = 20 + 2N + N + N + N + 20 = 40 + 5N
```

- `min(N, 10·S)` is the realistic cold scorer term: bounded by `N` (one/fixture) and by `10·S = 200` (concurrent-burst ceiling across ≤20 leagues).
- **Discovery is constant 20** regardless of `N` (one `/fixtures` call per enabled league).

### 5.2 Component tables (cold run, single attempt)

| Component | N=30 | N=50 | N=100 | N=150 | N=220 |
|---|---|---|---|---|---|
| 1. Fixture discovery (`/fixtures`) | 20 | 20 | 20 | 20 | 20 |
| 2. Team statistics (`/teams/statistics`) — ceiling `2N` | 60 | 100 | 200 | 300 | 440 |
| 3. Head-to-head (`/fixtures/headtohead`) | 30 | 50 | 100 | 150 | 220 |
| 4. Injuries (`/injuries`) | 30 | 50 | 100 | 150 | 220 |
| 5. Odds (`/odds`) | 30 | 50 | 100 | 150 | 220 |
| 6. Top scorers (`/players/topscorers`) — ceiling `N` | 30 | 50 | 100 | 150 | 220 |
| **Ceiling total `20 + 6N`** | **200** | **320** | **620** | **920** | **1,340** |

### 5.3 Theoretical maximum vs realistic expected vs measured

| Scenario | N=30 | N=50 | N=100 | N=150 | N=220 |
|---|---|---|---|---|---|
| **Theoretical maximum** — cold, every shared key collides, single attempt (`20 + 6N`) | **200** | **320** | **620** | **920** | **1,340** |
| **Realistic expected (cold)** — logical dedup on stats/h2h/inj/odds, realistic scorer collisions (`≈20 + 4.9N + min(N,200)`) | ≈197 | ≈315 | ≈610 | ≈905 | ≈1,298 |
| **Original audit model** — logical dedup everywhere (`40 + 5N`) | 190 | 290 | 540 | 790 | 1,140 |
| **Understatement of the report's own "theoretical max"** vs the corrected ceiling | **+10** (+5%) | **+30** (+10%) | **+80** (+15%) | **+130** (+16%) | **+220** (+19%) |
| **Measured** | — | — | — | — | **[NOT MEASURED]** |

> **Reading the table:** the realistic and ceiling columns converge because in a 48 h window the team-statistics dedup is negligible **and** the realistic scorer-collision term already reaches `N` for `N ≤ 200` (fixtures are league-grouped, so same-league bursts collide). The original report's figure sits **below both**, i.e. it is an **optimistic lower bound**, not a maximum.

### 5.4 Retry and fallback overhead

- **Retries [VERIFIED]:** `withBoundedRetry` allows **`DEFAULT_RETRIES = 2`** → up to **3 attempts** per request; retries only recoverable failures (network/timeout/5xx/429); honours `Retry-After`; never retries auth/quota — [retry.ts](file:///workspace/lib/api/retry.ts#L112-L143).
- **Normal retry overhead (+10%)** and **adverse retry overhead (+25%)** are the original audit's assumptions. **[ESTIMATED — unsourced]** the underlying failure rates are not measured.
- **Absolute retry ceiling = 3×** every request.

| Overhead model | N=30 | N=50 | N=100 | N=150 | N=220 |
|---|---|---|---|---|---|
| Ceiling, no retries (`20 + 6N`) | 200 | 320 | 620 | 920 | 1,340 |
| **+ normal retries (×1.10)** | 220 | 352 | 682 | 1,012 | 1,474 |
| **+ adverse retries (×1.25)** | 250 | 400 | 775 | 1,150 | 1,675 |
| **Absolute retry ceiling (×3)** | 600 | 960 | 1,860 | 2,760 | 4,020 |
| **30-day, realistic cold + normal retries (×30)** | ≈6,600 | ≈10,560 | ≈20,460 | ≈30,360 | ≈44,220 |

- **Fallback provider (Football-Data.org):** first-success-wins; API-Football is first, so **0 extra requests** in normal operation — [fixtures.ts](file:///workspace/lib/analysis/ingestion/fixtures.ts#L39-L57); [enrichment.ts](file:///workspace/lib/analysis/ingestion/enrichment.ts#L33-L43). **[VERIFIED]**

---

## 6. Part 4 — Verification of the optimisation savings (35–40%)

### 6.1 Decompose each saving, once

Baseline for percentages below: the **corrected cold baseline `20 + 6N`** (and, where stated, the report's own `40 + 5N`). All savings are **[ESTIMATED]** (they depend on cross-run cache survival and real collisions).

| # | Optimisation | Requests saved / run | Mechanism | Freshness risk |
|---|---|---|---|---|
| 1 | **Single-flight dedup** | Removes only **concurrent duplicates** on shared keys: scorer dups `∈ [0, N−S]`, team-stats dups small in 48 h. **≈0–80 at N=100.** | Share one in-flight promise per key | None (same data) |
| 2 | **Team-stats TTL 24 h → 48 h** | **≈ U ≈ 2N** (the whole team-stats term becomes a cross-run hit) | Key survives to next run | Season aggregates up to ~1 matchday stale — **mild** |
| 3 | **H2H TTL 24 h → 7 d** | **≈ 0.83N** (recurring pairs hit) | Historical results immutable once played | A newly played meeting within 7 d could be missing — **low** |
| 4 | **Top-scorer TTL extension** | **≈ S ≈ 20** | League leaderboard cached ≥1 run | Leaderboard can move every matchday — **moderate** for PLAYER_SCORER |

### 6.2 Double-counting check (required)

- **#1 and #4 overlap:** #1 lists "scorer dups" and #4 lists "scorer TTL" — both target the **scorer key**. On a **warm cache** (which #4 creates) there are **no** concurrent misses, so #1's scorer component collapses to 0. **The original report counts both → it double-counts the scorer term.**
- **#1 and #2/#3 overlap:** once #2/#3 make a key a cross-run hit, that key also has no cold misses, so #1's team/H2H components are also subsumed. Savings #1..#4 are **not additive**.

### 6.3 Clean, non-double-counted totals

Taking the **max per key** (not the sum) and crediting single-flight only where a TTL extension does **not** already eliminate the request:

```
Clean steady-state saving ≈ team-stats (2N) + h2h (0.83N) + scorers (S ≈ 20)
                          ≈ 2.83N + 20
```

| N | Cold baseline `20+6N` | Clean saving ≈`2.83N+20` | % of corrected cold | % of report's `40+5N` |
|---|---|---|---|---|
| 30 | 200 | ≈105 | **≈52%** | 55% |
| 50 | 320 | ≈162 | **≈51%** | 56% |
| 100 | 620 | ≈303 | **≈49%** | 56% |
| 150 | 920 | ≈445 | **≈48%** | 56% |
| 220 | 1,340 | ≈643 | **≈48%** | 56% |

### 6.4 Verdict on Part 4

- The **35–40%** figure is **mathematically *supported* but not rigorously derived**, and it is **conservative** relative to the clean decomposition above (≈48–52%). It is *not* an overstatement.
- However, the report **double-counts the scorer term** between its optimisation items #1 and #4, and it applies percentages to the optimistic `40 + 5N` baseline rather than the corrected cold baseline.
- **The savings are conditional, not guaranteed.** Items #2–#4 assume the previous run's cache **survives** to the next run. With `FOOTBALL_CACHE_TTL_SECONDS` defaulting to 24 h and the cron interval ≈ 24 h, a key written at 06:00 expires at ≈06:00 the next day — a **race**. The stated savings therefore only materialise if the TTL is raised **and** the run interval stays strictly below the new TTL **and** Redis is available. **[VERIFIED mechanism; ESTIMATED outcome]**
- **Freshness risks (must not be optimised away):** keep **odds** and **injuries** on a short TTL — the Asian-Handicap line and injury lists are the two most prediction-sensitive inputs — [football-api.ts](file:///workspace/lib/api/football-api.ts#L310-L364), [football-api.ts](file:///workspace/lib/api/football-api.ts#L265-L278). Extending the **top-scorer** TTL to days risks a stale PLAYER_SCORER pick; keep it ≤ 24–48 h.

---

## 7. Part 5 — Verification of API-Football quota assumptions

### 7.1 Claims supported by official evidence [VERIFIED — 2026-11-22]

| Claim | Value | Source |
|---|---|---|
| Free daily allowance | **100 requests/day** | Pricing page `https://www.api-football.com/pricing/` |
| Pro daily allowance | **7,500 requests/day** | Pricing page |
| Ultra daily allowance | **75,000 requests/day** | Pricing page |
| Mega daily allowance | **150,000 requests/day** | Pricing page |
| Custom maximum | up to **1,500,000 requests/day** | Pricing page |
| Free per-minute limit | **10 requests/minute** | `https://www.api-football.com/news/post/how-ratelimit-works` |
| Pro per-minute limit | **300 requests/minute or 5 requests/second** | same post |
| Ultra per-minute limit | **450 requests/minute or 7 requests/second** | same post |
| Mega per-minute limit | **900 requests/minute or 15 requests/second** | same post |
| Custom per-minute limit | **1,200 requests/minute** | same post |
| Account-status endpoint | **`GET /status`** → `subscription.plan`, `requests.current`, `requests.limit_day`; **does not count against the daily quota** | `https://www.api-football.com/documentation-v3` |
| Response quota headers | `x-ratelimit-requests-limit` (per day), `x-ratelimit-requests-remaining` (per day), `X-RateLimit-Limit` (per minute), `X-RateLimit-Remaining` (per minute) | documentation-v3 + optimisation post |
| Excess-quota behaviour | "once your quota is reached, the API automatically stops processing requests and sends an error message" | Pricing FAQ |
| Rate-limit enforcement | exceeding the per-minute rate "may be temporarily or permanently blocked by our firewall" | documentation-v3 |

### 7.2 Claims that could NOT be verified [FLAGGED]

- **Exact Free-season restriction window.** The pricing page only states *"Free plans are limited in terms of available seasons"* — it does **not** publish which seasons. The repository models this as "age between 2 and 4 years" — [provider-mapping.ts](file:///workspace/lib/api/provider-mapping.ts#L109-L116):
  ```ts
  API_FOOTBALL_FREE_TIER_SEASON_MIN_YEARS_AGO = 4;
  API_FOOTBALL_FREE_TIER_SEASON_MAX_YEARS_AGO = 2;
  ```
  This is a **repository assumption**, not provider documentation. **[FLAGGED]** — the original audit's "Year-4…Year-2" phrasing implies a precision the provider does not publish.
- **Per-minute figures live on a marketing/news post, not the versioned docs page.** Treat them as **provider-published but secondary**; the docs page confirms the *headers* exist but not their numeric values. **[FLAGGED — provenance]**
- **Pro "≈5× headroom".** Recomputed in §5: the corrected absolute worst case (3× retry at 220 fixtures) is ≈4,020 requests = **≈1.9× headroom**, not 5×. The "5×" holds only for the un-retried, no-collision case. **[FLAGGED — overstated]**
- The original audit's cited header names are correct, but its claim that it "reads" them is correctly **negative** (the app reads only `retry-after` — [football-api.ts](file:///workspace/lib/api/football-api.ts#L66)).

### 7.3 What the app does with this today [VERIFIED]

- Reads **only** `retry-after` from responses — [football-api.ts](file:///workspace/lib/api/football-api.ts#L66).
- Never calls `GET /status`; never reads any `x-ratelimit-*` / `X-RateLimit-*` header. → **Quota-blind** (confirmed).

---

## 8. Part 6 — Concurrency and rate-limit verification

### 8.1 Maximum simultaneous provider requests [VERIFIED + CALCULATED]

```
MAX_CONCURRENCY = 10 fixtures          (enrichment.ts L7)
  × 6 parallel calls per fixture       (football-api.ts L159–166: 2 stats + h2h + injuries + odds + scorers)
  = up to 60 simultaneous API-Football requests
  + 1 weather call per fixture (Open-Meteo, quota-neutral)
```

Because `Promise.all` starts all six calls per fixture in the same tick, and `mapWithConcurrency` starts 10 fixtures together, the ingestion path can initiate **≈60 API-Football requests in a single burst**.

### 8.2 Is there a provider-wide rate limiter? — **No** [VERIFIED]

A repo-wide search for `lib/ratelimit` shows imports **only** in `app/api/**` routes and tests (auth, admin, payments, public, cms, media, health, …). The ingestion path (`lib/analysis/**`, `lib/api/**`) imports **none** of it. The API-Football `request()` helper calls `assertProviderAvailable()` (circuit breaker) but **no limiter** — [football-api.ts](file:///workspace/lib/api/football-api.ts#L55-L58).

The **only** protections on the provider path are:
- `withBoundedRetry` (≤3 attempts, `Retry-After`-aware) — [retry.ts](file:///workspace/lib/api/retry.ts#L112-L143).
- A distributed **circuit breaker**: threshold **5** recoverable failures / **120 s** window → **60 s** cooldown — [circuit-breaker.ts](file:///workspace/lib/api/circuit-breaker.ts#L19-L21).

### 8.3 HTTP 429 risk at 10 concurrent fixtures

| Plan | Burst (≈60) vs per-minute | Burst vs per-second | 429 risk |
|---|---|---|---|
| **Free** | 60 vs **10/min** | — | **Certain** — the smallest run blows the per-minute cap immediately |
| **Pro** | 60 vs 300/min → OK | 60 vs **5/s** → **exceeded** | **High** — a ~60-request burst almost certainly exceeds 5 req/s |

**Failure-mode analysis [VERIFIED classification]**
- A plain per-minute/second 429 (no quota keyword) is classified **recoverable** → `ProviderRateLimitError`, retried with `Retry-After` — [retry.ts](file:///workspace/lib/api/retry.ts#L158-L166).
- A 429 **with** `quota|for the day|daily limit|out of requests` is classified **non-recoverable** → `ProviderQuotaExhaustedError`, **not** retried, and **fails the run** — same lines.
- **Retry-storm risk:** 60 near-simultaneous 429s are each retried up to twice. Recoverable failures also feed the circuit breaker, so **5 failures within 120 s open the circuit** → subsequent `assertProviderAvailable()` throws `ProviderCircuitOpenError`, failing the run — [circuit-breaker.ts](file:///workspace/lib/api/circuit-breaker.ts#L66-L87). Thus an otherwise-transient throttle burst can escalate into a **failed daily run**.

**Verdict on Part 6:** the scheduler can generate **up to ≈60 simultaneous provider requests** with **no provider-wide rate limiter**. At 10 concurrent fixtures the Pro **per-second (5/s)** ceiling is exceeded, so **HTTP 429 is a realistic risk even on Pro**, independent of the daily quota.

---

## 9. Recommendations (audit only — nothing implemented)

Prioritised; all are read-only observations of what *would* close the gaps.

1. **Read and log quota headers, and pre-flight `GET /status` once per run** (it is quota-free). Abort/alert if `remaining < 1.5 × expected run size`. This removes quota-blindness at the cost of ≤1 free request/run.
2. **Add a provider-wide rate limiter to the ingestion path** sized to the plan's per-second allowance (Pro = 5/s), so the 60-request burst is paced. This is the only fix that addresses the per-minute/429 risk.
3. **Add single-flight to `cachedProviderFetch`** (in-process promise map keyed by cache key) — removes the scorer/team concurrent duplicates described in Parts 1–2.
4. **Tier the TTLs deliberately:** team-stats 48 h, H2H 7 d, top-scorers ≤24–48 h; **keep odds and injuries short**. Do not count single-flight and TTL savings on the same key twice.
5. **Correct the planning model** in the original audit: use `20 + 6N` as the cold ceiling and `≈20 + 4.9N + min(N,200)` as realistic; apply retry amplification of up to 3× for worst-case headroom.
6. **Do not treat the "5× headroom" claim as a safety margin** — the retry-amplified ceiling leaves ≈1.9×.

---

## 10. Final verdict — is the API-Football **Pro** recommendation still justified?

> ## **YES — PRO REMAINS JUSTIFIED. The recommendation stands, with a reduced margin.**
>
> **Free is definitively unusable** — 100 requests/day is exceeded by every scenario (the smallest cold ceiling is 200), the Free per-minute cap is 10 (the burst is ~60), and Free is season-restricted. **[VERIFIED + CALCULATED]**
>
> **Pro (7,500/day) still covers every scenario** under the corrected arithmetic:
> - realistic cold + normal retries ≈ **197–1,474 / day**
> - adverse +25% retries ≈ **250–1,675 / day**
> - **absolute worst case (3× retry at 220 fixtures) ≈ 4,020 / day ≈ 54% of Pro.**
>
> So Pro is sufficient, but the honest **worst-case headroom is ≈1.9×, not the ≈5× the original audit implied**, and the numbers in the original audit should be replaced by the corrected model in §5.
>
> **Two risks remain that the Pro plan does not, by itself, solve:**
> 1. **Per-second 429s.** The enrichment scheduler can burst ~60 requests with no provider-wide limiter, exceeding Pro's **5 req/s** and risking 429 waves that can cascade into an open circuit breaker and a **failed run**.
> 2. **Quota-blindness.** The app never reads its remaining-quota headers or the free `GET /status`, so exhaustion is discovered only as a failed run.
>
> Neither risk overturns the recommendation — both are addressable by the safeguards in §9 — but **the Pro choice should be paired with a provider rate limiter and quota monitoring before production**, and the consumption figures in `docs/PREDICTPRO_API_CONSUMPTION_AUDIT.md` should be corrected to `20 + 6N` (ceiling) / `≈20 + 4.9N + min(N,200)` (realistic).

---

## Appendix A — Corrected vs original figures (summary)

| Quantity | Original audit | Corrected | Basis |
|---|---|---|---|
| Cold-run ceiling | `40 + 5N` | **`20 + 6N`** | [CALCULATED] scorers ceiling = `N`, team ceiling = `2N` |
| N=100 ceiling | 540 | **620** | [CALCULATED] |
| N=220 ceiling | 1,140 | **1,340** | [CALCULATED] |
| Retry attempts per request | up to 3 | up to 3 (confirmed) | [VERIFIED] |
| Worst case with retries (N=220) | ≈1,425 (adverse) | **≈4,020 (3× ceiling)** | [CALCULATED] |
| Optimisation saving | 35–40% | **≈48–52%** of corrected cold (clean, non-double-counted) | [ESTIMATED] |
| Max simultaneous provider requests | not stated | **≈60** | [CALCULATED] |
| Provider-wide rate limiter | absent | **absent (confirmed)** | [VERIFIED] |
| Pro headroom at worst case | ≈5× | **≈1.9×** | [CALCULATED] |
| Measured consumption | "not yet measured" | **still NOT MEASURED** | no live key |

## Appendix B — Code references

- [football-api.ts](file:///workspace/lib/api/football-api.ts) — `fetchApiFootballEnrichment` (L144–177; `Promise.all` L159–166), `fetchTeamStats` (L179–188), `fetchH2H` (L214–225), `fetchInjuries` (L265–278), `fetchOdds` (L310–364), `fetchScorers` (L366–381), `fetchApiFootballFixtures` (L91–121), `request()` header read (L66).
- [cache.ts](file:///workspace/lib/analysis/ingestion/cache.ts) — `cachedProviderFetch` (read-through, **no single-flight**), `CACHE_TTL_SECONDS` (default 24 h).
- [enrichment.ts](file:///workspace/lib/analysis/ingestion/enrichment.ts) — `MAX_CONCURRENCY = 10` (L7), `mapWithConcurrency` (L9–23), `enrichFixtures` (L25–57).
- [fixtures.ts](file:///workspace/lib/analysis/ingestion/fixtures.ts) — `FIXTURE_WINDOW_HOURS = 48` (L8), `getEnabledLeagues` ordering (L21–27), `fetchFixtures` (L29–60), `dedupeFixtures` (L67–75).
- [retry.ts](file:///workspace/lib/api/retry.ts) — `withBoundedRetry` (L112–143; ≤3 attempts), `providerErrorFromResponse` (L149–177), `parseRetryAfter` (L96–106).
- [circuit-breaker.ts](file:///workspace/lib/api/circuit-breaker.ts) — threshold 5 / window 120 s / cooldown 60 s (L19–21), `assertProviderAvailable` (L66–70).
- [redis.ts](file:///workspace/lib/redis.ts) — fail-closed in production.
- [provider-mapping.ts](file:///workspace/lib/api/provider-mapping.ts) — free-tier season helper (L109–116).
- `lib/ratelimit.ts` — imported only by `app/api/**` routes and tests (no ingestion-path usage).

## Appendix C — Official sources (accessed 2026-11-22)

- Pricing — `https://www.api-football.com/pricing/` (Free 100/day; Pro $19 · 7,500/day; Ultra 75,000/day; Mega 150,000/day; Free limited seasons).
- Documentation v3 — `https://www.api-football.com/documentation-v3` (`GET /status`; response headers; firewall note).
- Rate-limit post — `https://www.api-football.com/news/post/how-ratelimit-works` (Free 10/min; Pro 300/min or 5/s; Ultra 450/min or 7/s; Mega 900/min or 15/s; Custom 1,200/min).
- Optimisation/quota post — `https://www.api-football.com/news/post/how-to-optimize-api-sports-calls-and-quota-usage` (header semantics).

**Not verifiable from available evidence:** the exact Free-plan season window (provider publishes only "limited"); real fixture distribution, real cache hit rate, real 429/5xx frequency, and actual per-run counters (all **[NOT MEASURED]** — require a live key).
