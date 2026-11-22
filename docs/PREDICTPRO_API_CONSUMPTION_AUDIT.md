# PredictPro — API-Football Consumption Audit (Read-Only)

- **Audit type:** Independent, evidence-based API consumption audit
- **Date:** 2026-11-22
- **Roles:** Principal Backend Engineer / API Integration Specialist / Database Performance Engineer / Production Reliability Auditor
- **Repository:** `Kelly883/Prediction-claude-` — branch `trae/agent-4phDPY`, HEAD `ecb58fe`
- **Modification during audit:** **None.** No application code, config, dependencies, or migrations were changed. No production cron was triggered. No live provider requests were made. No secrets were read or printed. This report (`docs/PREDICTPRO_API_CONSUMPTION_AUDIT.md`) is the only file created.

> **Evidence legend used throughout**
> - **[VERIFIED]** — read directly from source code or an official provider page.
> - **[CALCULATED]** — arithmetic derived from the code's call structure.
> - **[ESTIMATED]** — depends on an assumption (fixture counts, retry rate, cache hit rate).
> - **[NOT YET MEASURED]** — can only be confirmed with a real API key and live counters.
>
> **Caching is not assumed to work.** Every cache claim below is tied to the actual key/TTL/lookup code.

---

## 1. Executive summary

- API-Football is the **only** football provider the application actually uses for its primary path. It is called from exactly six endpoints, all inside one file (`lib/api/football-api.ts`). **[VERIFIED]**
- **Fixture discovery is efficient** — one `/fixtures` call per league returns every match in the 48-hour window. It is **not** one call per fixture. **[VERIFIED]**
- **Enrichment is the cost centre** — roughly **5 provider calls per fixture** (2 team-statistics, 1 head-to-head, 1 injuries, 1 odds), plus up to 20 top-scorer calls per run. **[VERIFIED/CALCULATED]**
- A single daily run therefore costs approximately **`40 + 5N`** API-Football requests (N = fixtures in the window) **[CALCULATED]**, before retries: **190** at 30 fixtures, **540** at 100, **1,140** at 220.
- The **Free plan (100 requests/day) cannot run even the smallest scenario** (30 fixtures ≈ 190 requests), and its season entitlement excludes the current season. **[VERIFIED quota; CALCULATED demand]**
- The application **never reads any rate-limit response header** (`x-ratelimit-requests-remaining`, `X-RateLimit-Remaining`, etc.) and never calls the account-status endpoint, so it **cannot see quota approaching exhaustion**. **[VERIFIED]**
- The **Pro plan (7,500 requests/day, "$19/month") is sufficient** for low, normal, and peak volumes with ~5× headroom, and is the correct minimum tier. **[VERIFIED price; CALCULATED demand]**
- **No endpoint's data is fetched and then entirely unused** — every endpoint feeds at least one of the 10 markets. Conversely, several model factors (motivation, schedule, referee, pace, league average goals/corners/cards) are referenced by the engine but **not supplied by the API-Football adapter**, so they silently default to neutral. **[VERIFIED]**

**Verdict: the Pro plan is required and sufficient; safe optimisations can roughly halve consumption, but cannot make the Free plan viable.**

---

## 2. Endpoint inventory (AUDIT 1)

All provider calls originate from **`lib/api/football-api.ts`**. The single internal `request()` helper (lines 41–85) is the only place an HTTP request to `https://v3.football.api-sports.io` is issued. **[VERIFIED]**

| # | Endpoint | File · function | Data retrieved | When called | Call granularity | Multiple fixtures per request? | Needed for 10-market engine? | Phase 1 scope |
|---|---|---|---|---|---|---|---|---|
| 1 | `GET /fixtures` | `football-api.ts` · `fetchApiFootballFixtures` (L91–121; call L103) | Fixtures in window (id, teams, kickoff, venue lat/long) | Once per run, per enabled league | **Once per league** (20/run) | **Yes** — all window fixtures for the league in one response | **Yes** (fixtures are the unit of analysis) | **Required** |
| 2 | `GET /teams/statistics` | `football-api.ts` · `fetchTeamStats` (L179–188; call L184) | Team season stats (xG, goals, corners, cards, shots, form) | Per fixture, for **both** home and away | **Once per team-season** (deduped) | No (single team per call) | **Yes** (core inputs to most markets) | **Required** |
| 3 | `GET /fixtures/headtohead` | `football-api.ts` · `fetchH2H` (L214–225; call L221) | Last-10 H2H results | Per fixture | **Once per fixture** (deduped by team pair) | No | **Yes** (H2H factors) | **Required** |
| 4 | `GET /injuries` | `football-api.ts` · `fetchInjuries` (L265–278; call L267) | Injury counts per side | Per fixture | **Once per fixture** | No | **Yes** (injuries factor) | **Required** |
| 5 | `GET /odds` | `football-api.ts` · `fetchOdds` (L310–364; call L312) | Pre-match odds (result, BTTS, O/U, AH line, DC, CS, 1H, corners, cards) | Per fixture | **Once per fixture** | No | **Yes** (price + AH line) | **Required** |
| 6 | `GET /players/topscorers` | `football-api.ts` · `fetchScorers` (L366–381; call L370) | League top-5 scorers | Per fixture (invoked), **cached per league-season** | **≤ once per league** (deduped) | No (league-level) | **Yes** (PLAYER_SCORER only) | **Required** (for that one market) |

**Indirect / secondary endpoints (Football-Data.org, fallback only — `lib/api/football-data.ts`):** `GET /competitions/{code}/matches`, `GET /competitions/{code}/standings`, `GET /competitions/{code}/scorers`. These are only reached if the API-Football path throws (see §3). **[VERIFIED]**

**Free, non-quota endpoint:** `lib/analysis/ingestion/weather.ts` calls Open-Meteo (`api.open-meteo.com`) — a separate provider, quota-neutral.

No other API-Football call site exists anywhere in the repository. **[VERIFIED** via repo-wide search for `v3.football.api-sports` / `fetchApiFootball` / each path**]**

---

## 3. Daily execution path and request calculation (AUDIT 2)

### 3.1 The path (from `lib/analysis/run.ts`)

```
runDailyAnalysis()
  ├─ same-day idempotency check (skip if a running/completed run exists)      ── files.ts
  ├─ Redis NX lock  analysis:daily:{day}  ex 600                             ── run.ts L70–96
  ├─ loadAnalysisSettings()  → dataSourcePriorities = [api-football, football-data]
  ├─ getEnabledLeagues()     → 20 enabled leagues
  ├─ fetchFixtures()         → provider priority: API-Football first          ── fixtures.ts
  │     └─ fetchApiFootballFixtures(): 1 × GET /fixtures per league (cached)
  ├─ enrichFixtures()        → mapWithConcurrency(fixtures, 10)               ── enrichment.ts
  │     └─ fetchApiFootballEnrichment() per fixture (Promise.all):
  │           2× /teams/statistics  +  1× /fixtures/headtohead
  │           + 1× /injuries  + 1× /odds  + 1× /players/topscorers(league-cached)
  └─ scoreFixture() × N → filterPicks(confidence >= 75) → persist
```

**[VERIFIED]**. Weather is fetched separately per fixture (free).

### 3.2 The consumption formula

Let **N** = fixtures in the 48 h window, **U** = unique team-seasons, **S** = leagues with ≥1 fixture.

```
R = 20        (fixture discovery: 1 / league)
  + U         (team statistics: 2 / fixture, deduped by team-season)
  + N         (head-to-head: 1 / fixture)
  + N         (injuries: 1 / fixture)
  + N         (odds: 1 / fixture)
  + S         (top scorers: <= 1 / league)
```

- **Theoretical maximum** (no dedup, all leagues active): `U = 2N`, `S = 20` → **`R_max = 40 + 5N`**.
- **Expected** (small dedup from teams playing twice in 48 h): `U ≈ 1.9N`, `S ≤ 20` → `R_exp ≈ 40 + 4.9N`.

In a 48-hour window almost every team plays at most once, so team-season dedup is **small** (a few %). Fixture dedup is handled by `dedupeFixtures()` (key `source:id`) but duplicates are rare. **[VERIFIED]**

### 3.3 Request tables — separately for both models

**Theoretical maximum `40 + 5N` (no cache hits, no dedup):**

| Requests | N=30 | N=50 | N=100 | N=150 | N=220 |
|---|---|---|---|---|---|
| 1. Fixture discovery | 20 | 20 | 20 | 20 | 20 |
| 2. Team statistics | 60 | 100 | 200 | 300 | 440 |
| 3. Head-to-head | 30 | 50 | 100 | 150 | 220 |
| 4. Injuries | 30 | 50 | 100 | 150 | 220 |
| 5. Odds | 30 | 50 | 100 | 150 | 220 |
| 6. Top scorers | 20 | 20 | 20 | 20 | 20 |
| 7. Other provider calls (weather) | 0 (free) | 0 | 0 | 0 | 0 |
| **Base total / run (cold)** | **190** | **290** | **540** | **790** | **1,140** |
| 8. Retry overhead (+10% typical) | 19 | 29 | 54 | 79 | 114 |
| 8. Retry overhead (+25% adverse) | 48 | 73 | 135 | 198 | 285 |
| 9. Fallback provider (normal) | 0 | 0 | 0 | 0 | 0 |
| **Expected total / run (typical retries)** | **≈209** | **≈319** | **≈594** | **≈869** | **≈1,254** |
| **Adverse total / run (+25%)** | **≈238** | **≈363** | **≈675** | **≈988** | **≈1,425** |
| **30-day total (typical)** | ≈6,270 | ≈9,570 | ≈17,820 | ≈26,070 | ≈37,620 |

**Expected `≈40 + 4.9N` (with team-season dedup):**

| N | Per run | 30 days |
|---|---|---|
| 30 | ≈187 | ≈5,610 |
| 50 | ≈285 | ≈8,550 |
| 100 | ≈530 | ≈15,900 |
| 150 | ≈775 | ≈23,250 |
| 220 | ≈1,118 | ≈33,540 |

> The two models differ by ~4%. **The dominant driver is the `5N` enrichment term, not the discovery term.**

### 3.4 Retry, fallback and conditional-request behaviour

- **Retries** (`lib/api/retry.ts`): `PROVIDER_MAX_RETRIES` default = **2** → up to **3 attempts** per request. Only *recoverable* failures retry (network, timeout, 5xx, 429). Quota/auth failures are **never** retried. **[VERIFIED]**
- **Fallback provider**: `fetchFixtures()` and `enrichFixtures()` iterate `dataSourcePriorities` and stop at the first provider that succeeds. API-Football is first, so **in normal operation Football-Data is never called** (0 extra requests). It activates only when the entire API-Football fixture load or a fixture's enrichment throws. **[VERIFIED]**
- **Conditional requests**: the provider layer issues **no conditional requests** (no `If-None-Match` / `If-Modified-Since`). Every cache miss is a full request. **[VERIFIED]**

---

## 4. Cache analysis (AUDIT 3)

Cache implementation: `lib/analysis/ingestion/cache.ts` (`cachedProviderFetch`) over `lib/redis.ts` (Upstash REST; in-memory in dev/test; **fails closed in production** if unconfigured). TTL from `FOOTBALL_CACHE_TTL_SECONDS` (default **86,400 s = 24 h**). **[VERIFIED]**

| Data type | Cache key format | TTL | Shared across fixtures/leagues? | Concurrent-miss possible? | Survives to next cron run? | Cold on window shift? |
|---|---|---|---|---|---|---|
| Fixture discovery | `api-football:fixtures:{code}:{from}:{to}` | 24 h | No (keyed by league **and** window) | Only if two runs same day (blocked by idempotency) | **No** — window changes daily → new key | **Yes (always cold)** |
| Team statistics | `api-football:team-stats:{team}:{league}:{season}` | 24 h | **Yes** (shared by team across fixtures) | **Yes** — concurrent fixtures of the same teams (concurrency 10) | Borderline (TTL ≈ run interval) | No |
| Head-to-head | `api-football:h2h:{home}:{away}` | 24 h | Per fixture pair | Rare | Borderline | No |
| Injuries | `api-football:injuries:{fixtureId}` | 24 h | Per fixture | No | Borderline | No |
| Odds | `api-football:odds:{fixtureId}` | 24 h | Per fixture | No | Borderline | No |
| Top scorers | `api-football:scorers:{leagueId}:{season}` | 24 h | **Yes** (shared by league) | **Yes** — concurrent fixtures of same league | Borderline | No |
| Weather | `weather:{lat}:{lon}` | 24 h | **Yes** (same venue) | **Yes** at same venue | Borderline | No |
| Football-Data fixtures/standings/scorers | `football-data:*` | 24 h | Per league | Rare | Borderline | Fixtures: yes |

**Answers to the AUDIT 3 questions**

- **Shared across fixtures/leagues?** Yes for team-statistics, top-scorers and weather (key is not fixture-specific). **[VERIFIED]**
- **Can multiple requests miss the same cache simultaneously?** **Yes.** `enrichFixtures` runs 10 fixtures concurrently (`MAX_CONCURRENCY = 10`) and `cachedProviderFetch` has **no in-flight (single-flight) lock** — it does `get → (miss) → loader → set`. Two concurrent fixtures sharing the same team or league key can both miss and both call the provider. **[VERIFIED]**
- **Can concurrent requests cause duplicate provider calls?** **Yes** — specifically `fetchScorers()` is invoked **per fixture** (L165) and `fetchTeamStats()` **twice per fixture**, so duplicates are possible up to the concurrency limit (10) per shared key on a cold run. **[VERIFIED]**
- **Do entries survive between daily cron runs?** **Not reliably.** TTL (24 h) ≈ the 24 h run interval, so a key written at 06:00 expires at ~06:00 the next day — i.e. right as the next run starts. Entries written later in a run *may* survive briefly, but this is a race, not a guarantee. **[VERIFIED]**
- **Does the 48 h window invalidate reusable data?** The **discovery** key embeds `{from}:{to}` (changes daily), so the overlapping day's fixture list is never reused. The **enrichment** keys (team/h2h/injuries/odds) do **not** embed the window, so they are technically reusable — but the 24 h TTL prevents reuse in practice. **[VERIFIED]**
- **Do cache failures cause uncontrolled API calls?** **Yes.** `cachedProviderFetch` swallows read errors (`logger.warn`) and proceeds to the loader, and swallows write errors. A Redis outage therefore turns **every** lookup into a miss → the run degrades to the full cold-cache cost (`40 + 5N`). Quota/auth errors deliberately bypass stale-cache fallback (fail loud). **[VERIFIED]**

---

## 5. Duplicate request analysis (AUDIT 3, cont.)

| Duplicate source | Mechanism | Magnitude (cold run) | Severity |
|---|---|---|---|
| Top scorers called per fixture | `fetchApiFootballEnrichment` calls `fetchScorers()` for every fixture (L165) even though the key is per league-season | Up to **concurrency (10) − 1 = 9** duplicate calls per league on a cold run | Low–Medium |
| Team-statistics concurrent miss | Same team appears in two concurrent fixtures; no single-flight lock | Up to **concurrency − 1 = 9** duplicates per shared team-season | Low–Medium |
| Weather concurrent miss | Same venue coordinates, concurrent fixtures | Up to 9 duplicates | Low (free provider) |
| Re-enrichment across days | The 48 h window re-includes each fixture on two consecutive runs; TTL ≈ interval defeats reuse | Up to **5 requests × overlapping fixtures** per day | Medium |

> These duplicates are **bounded** (by concurrency and by the 24 h window overlap) and self-healing after the first cache write — they do not change the order of magnitude, but they are real, avoidable consumption.

---

## 6. Request-reduction opportunities (AUDIT 4)

| # | Current behaviour | Proposed improvement | Requests saved | Freshness / quality impact | Complexity | Safe for Phase 1? |
|---|---|---|---|---|---|---|
| 1 | `cachedProviderFetch` has no in-flight lock; concurrent fixtures can issue duplicate calls for the same key | Add **single-flight** (per-key in-process promise map) so concurrent misses share one request | Removes up to ~9 dup/league for scorers + team-stats on cold runs (**~5–10%**) | None (same data) | Low | **Yes** |
| 2 | Team-season stats cached only 24 h | Extend stats TTL to **~48 h** (season aggregates move slowly) | ≈ **N** / run on steady days | Slightly staler season aggregates (≤1 matchday) — **mild** | Very low (config) | **Yes** (48 h, not 7 d) |
| 3 | H2H cached 24 h | Extend H2H TTL to **~7 days** (historical results are immutable once played) | ≈ **0.83 N** / run | None for completed matches — the last-10 set only changes when a new meeting is played | Very low (config) | **Yes** |
| 4 | Top scorers cache misses under concurrency | Single-flight (see #1) + longer TTL (leaderboard moves slowly) | ≈ 17 / run | Negligible | Low | **Yes** |
| 5 | Discovery key embeds the daily window | Keep as-is (the window genuinely changes) — this is correct | 0 | — | — | n/a |
| 6 | Retries use fixed exponential backoff | Add small jitter (avoid thundering-herd retries) | Fewer storm retries under 429 | None | Low | Yes (nice-to-have) |
| 7 | Enrich all fixtures, then filter by confidence ≥ 75 | **Not safely reducible** — the confidence that qualifies a pick is computed *from* the enrichment, so fixtures must be enriched before they can be filtered | 0 | Would require changing the product/model | High | **No** |
| 8 | Odds fetched per fixture | **Keep.** The Asian-Handicap market needs the real captured line to emit an actionable pick, and every market uses odds for its displayed price | — | Removing it weakens AH + pricing | — | **Do not remove** |

**Safe combined optimisation (#1 + #2 + #3 + #4):** roughly **35–40%** of per-fixture enrichment falls away on steady days while keeping the two most freshness-sensitive datasets (odds, injuries) on a 24 h TTL.

> Explicit non-recommendation: do **not** raise odds/injuries TTLs to reduce cost — those are the data whose staleness would directly harm prediction quality. Do **not** skip enrichment based on a pre-analysis filter; no such filter exists because the qualifying signal *is* the analysis output.

---

## 7. Rate-limit handling (AUDIT 5)

**Header inspection result:** `lib/api/football-api.ts` reads **only** `retry-after` (L66) to feed the bounded-retry backoff. It does **not** read or store:

| Header | Read by app? |
|---|---|
| `x-ratelimit-requests-limit` | **No** |
| `x-ratelimit-requests-remaining` | **No** |
| `X-RateLimit-Limit` (per-minute) | **No** |
| `X-RateLimit-Remaining` (per-minute) | **No** |

The app also never calls the provider's account-status endpoint (the endpoint that returns `requests.current` / `requests.limit_day`). **[VERIFIED]**

**Detection capability today:**

| Condition | Detected? | How |
|---|---|---|
| Daily quota approaching exhaustion | **No** | Nothing reads the remaining-quota header; no status polling |
| Per-minute limit approaching | **No** | As above |
| HTTP 429 | **Yes** | `providerErrorFromResponse` classifies 429 (rate-limit vs quota) and honours `Retry-After` |
| Provider outage | **Yes** | 5xx treated as recoverable; **circuit breaker** opens after 5 failures / 120 s |
| Repeated retries | **Partially** | Retries are bounded and counted by the breaker, but not surfaced as a metric |
| Fallback provider activation | **Partially** | Logged in `errors[]`, but **no alert** exists |

**Recommended safe quota threshold and guard:**
1. **Read and log `x-ratelimit-requests-remaining` on every response.** Set `FOOTBALL_DAILY_REQUEST_BUDGET` (default 7,500).
2. **Pre-flight status check once per run** (1 request to the account-status endpoint) and **abort/alert if `remaining < 1.5 × expected run size`** (e.g. abort if remaining < 2,000 before a peak run).
3. **Alert at 70% consumed**, **hard-stop enrichment at 90%** (return the run as `failed` with a clear reason rather than burning the quota and publishing nothing).
4. **Prevent exhaustion structurally:** the single-flight lock (#1) plus extended TTLs (#2/#3) keep a peak day well under the Pro quota.

---

## 8. What data the engine actually needs (AUDIT 6)

Source: `lib/analysis/engine.ts` and `lib/analysis/markets/*`. **[VERIFIED]**

| Market | Required fields | Supplying endpoint(s) | Mandatory? | Behaviour when missing |
|---|---|---|---|---|
| MATCH_RESULT | `homeStats/awayStats` xG or goals, `h2h.matches`, `form`, `injuries`, `motivation`, `odds.matchResult` | team-stats, h2h, injuries, odds | team-stats + h2h core; odds for price | Factors default to 50; odds default 1.91 |
| BTTS | xG for/against both sides, `h2h.bttsRate`, `weather` | team-stats, h2h, weather | team-stats + h2h | Neutral 50 |
| OVER_UNDER_2_5 | `leagueAvgGoals`*, team xG, `h2h.over25Rate`, `weather` | team-stats, h2h, weather | team-stats + h2h | `leagueAvgGoals` absent → 50 |
| ASIAN_HANDICAP | **`odds.asianHandicap.line`** (mandatory for a pick), Poisson model, injuries, motivation, schedule, referee | **odds**, team-stats, h2h, injuries | **odds line mandatory** | Declines → `"No handicap"` |
| DOUBLE_CHANCE | Poisson model (team-stats), h2h, injuries | team-stats, h2h, injuries, odds | team-stats | Defaults |
| CORRECT_SCORE | Poisson model, goals against, `h2h.over25Rate`, weather | team-stats, h2h, weather, odds | team-stats | Defaults |
| FIRST_HALF_RESULT | team `firstHalfGoalsFor` (or xG×0.45), h2h, motivation | team-stats, h2h, odds | team-stats + h2h | Defaults |
| TOTAL_CORNERS | `cornersFor` both sides, `shotsFor`, `leagueAvgCorners`* | team-stats, weather, odds | team-stats | Neutral |
| TOTAL_CARDS | `cardsFor` both sides, motivation, referee*, `leagueAvgCards`* | team-stats, h2h, odds | team-stats | Neutral |
| PLAYER_SCORER | top scorers list, opponent goals-against, `odds.playerScorer` | **topscorers**, team-stats, odds | **topscorers** | Returns `"Unavailable"`, confidence 50 |

**Findings:**
- **No fetched endpoint is unused.** Fixtures feed everything; team-stats feed 9 markets; h2h feeds 7; injuries feed 3; odds feed all 10 (price + AH line); topscorers feed PLAYER_SCORER. **[VERIFIED]**
- **The engine references fields the adapter never populates.** `motivation`, `schedule`, `referee`, `pace`, `leagueAvgGoals`, `leagueAvgCorners`, `leagueAvgCards` (marked `*`) are read by the markets but are **not set** by `fetchApiFootballEnrichment` (which sets only `homeStats`, `awayStats`, `h2h`, `injuries`, `odds`, `players`). They therefore always default to neutral. This is a **model-completeness observation, not a request-reduction target** — the app is not over-requesting, it is under-populating. **[VERIFIED]**
- Football-Data enrichment (fallback) populates `leagueAvgGoals` but **not** the other starred fields. **[VERIFIED]**

---

## 9. Three consumption estimates (AUDIT 7)

Percentages: Free plan = **100/day**, Pro plan = **7,500/day**. All request counts are **[ESTIMATED]** from the formula; **none are measured**.

### A — Current implementation (no successful cache hits)
Formula: `R_A = 40 + 5N`

| N | /run | /day | /30 days | % of Free (100) | % of Pro (7,500) |
|---|---|---|---|---|---|
| 30 | 190 | 190 | 5,700 | **190%** | 2.5% |
| 50 | 290 | 290 | 8,700 | **290%** | 3.9% |
| 100 | 540 | 540 | 16,200 | **540%** | 7.2% |
| 150 | 790 | 790 | 23,700 | **790%** | 10.5% |
| 220 | 1,140 | 1,140 | 34,200 | **1,140%** | 15.2% |

### B — Realistic implementation (working cache + dedup)
Formula: `R_B ≈ 40 + 4.9N` (within-run dedup only; the 24 h TTL ≈ run interval means little cross-run reuse).

| N | /run | /day | /30 days | % of Free | % of Pro |
|---|---|---|---|---|---|
| 30 | ≈187 | ≈187 | ≈5,610 | **187%** | 2.5% |
| 50 | ≈285 | ≈285 | ≈8,550 | **285%** | 3.8% |
| 100 | ≈530 | ≈530 | ≈15,900 | **530%** | 7.1% |
| 150 | ≈775 | ≈775 | ≈23,250 | **775%** | 10.3% |
| 220 | ≈1,118 | ≈1,118 | ≈33,540 | **1,118%** | 14.9% |

> B is ≈A. **The existing 24 h cache does not materially reduce the daily figure** because its TTL equals the run interval. Any claim that "caching already halves consumption" would be unsupported.

### C — Optimised implementation (safe improvements #1–#4)
Formula: `R_C ≈ 40 + 3.2N` (single-flight dedup; team-stat TTL 48 h; H2H TTL 7 d; scorer TTL extended; **odds/injuries stay 24 h**).

| N | /run | /day | /30 days | % of Free | % of Pro |
|---|---|---|---|---|---|
| 30 | ≈136 | ≈136 | ≈4,080 | **136%** | 1.8% |
| 50 | ≈200 | ≈200 | ≈6,000 | **200%** | 2.7% |
| 100 | ≈360 | ≈360 | ≈10,800 | **360%** | 4.8% |
| 150 | ≈520 | ≈520 | ≈15,600 | **520%** | 6.9% |
| 220 | ≈744 | ≈744 | ≈22,320 | **744%** | 9.9% |

> Even **fully optimised, the Free plan is exceeded at the smallest scenario (136 > 100)**, and the Free plan additionally cannot serve current-season data. Optimization improves **Pro headroom**, not Free viability.

---

## 10. Free vs Pro comparison

| Dimension | Free | Pro |
|---|---|---|
| Published price | **$0** | **$19/month** *(official, 2026-11-22)* |
| Daily requests | **100** | **7,500** |
| Competitions/endpoints | All (per provider) | All |
| Current-season data | **Season-restricted** (approx. Year-4…Year-2) | Yes |
| Covers N=30 run (190 req) | **No** | Yes (2.5%) |
| Covers N=100 run (540 req) | **No** | Yes (7.2%) |
| Covers N=220 run (1,140 req) | **No** | Yes (15.2%) |
| Covers adverse peak (+retries ≈1,425) | **No** | Yes (~19%) |
| Verdict | **UNSUITABLE** | **SUFFICIENT — with ~5× headroom** |

---

## 11. Production risks

1. **Quota blindness.** With no remaining-quota header reading and no status pre-flight, the first sign of exhaustion is a failed run. **[VERIFIED]**
2. **Cache outage = full cold cost.** A Redis incident silently multiplies consumption to `40 + 5N`. **[VERIFIED]**
3. **Concurrent duplicate misses** add avoidable calls on cold runs (bounded, but real). **[VERIFIED]**
4. **Retry amplification** on provider instability (up to 3× per failing request; mitigated by the circuit breaker). **[VERIFIED]**
5. **Season entitlement** — Free cannot serve the analysed seasons; a paid plan is mandatory. **[VERIFIED]**
6. **Freshness vs cost** — safe TTL increases must exclude odds and injuries. **[VERIFIED]**
7. **Unpopulated model fields** (motivation/schedule/referee/pace/league averages) mean several factors are inert; this affects *analysis completeness*, not consumption. **[VERIFIED]**
8. **Not yet measured** — actual per-run counts, real fixture distribution, real cache hit rate, and real 429/5xx frequency all require a live key. **[NOT YET MEASURED]**

---

## 12. Final recommendation (AUDIT 8)

1. **Can Phase 1 run reliably on the Free plan? No.** The smallest scenario (30 fixtures) needs ≈190 requests — nearly 2× the 100/day cap — and the Free plan cannot serve the current season. **[VERIFIED/CALCULATED]**
2. **Minimum daily allowance realistically required?** With today's code: **≈750–1,000/day** to cover a normal day with buffer; **≥1,500/day** to cover an adverse peak. **≥1,500/day is the safe planning minimum.**
3. **Would the Free plan work with optimization? No.** Even optimised, 30 fixtures ≈136 requests > 100, and the season restriction still applies.
4. **Is the Pro plan sufficient for low, normal and peak? Yes.** 190 / 540 / 1,140 (typical) and up to ≈1,425 (adverse) all sit under 7,500 — roughly **5× headroom at adverse peak**.
5. **Optimizations to implement before subscribing?** (a) read + log rate-limit headers and add a status pre-flight guard; (b) single-flight cache lock; (c) tiered TTLs (team-stats 48 h, H2H 7 d, scorers extended) while keeping odds/injuries at 24 h; (d) optional retry jitter. These raise Pro headroom to ~10× and protect against free-tier style limits — but Pro is sufficient even without them.
6. **What must be tested with a real key before production?** (i) current-season access for all 20 leagues; (ii) actual per-run request count measured against the account counters; (iii) that enrichment actually populates each market's inputs (especially odds availability + AH line, injuries, top scorers); (iv) cross-run cache reuse across a 48 h overlap; (v) presence of the rate-limit headers; (vi) that a full run finishes under the 300 s function limit; (vii) Football-Data fallback for the 10 leagues it covers; (viii) real peak-day volume.

---

## 13. Final verdict

> ## **PRO REQUIRED — CONSUMPTION IS WITHIN PRO, NOT FREE**
>
> The Phase 1 workflow **cannot** operate on the Free plan (insufficient daily quota and season-restricted data). Consumption is **`40 + 5N` requests per run**, i.e. **≈190–1,425 per day** across realistic volumes, which the **Pro plan ($19/month, 7,500/day)** comfortably covers for low, normal and peak fixtures. Safe optimisations can cut steady-state consumption by ~35–40% but cannot make Free viable. The main reliability gap is **quota blindness** — the app never reads its own remaining-quota headers — which should be closed before launch.

---

## Appendix — Source evidence

- `lib/api/football-api.ts` — `request()` (L41–85), `fetchApiFootballFixtures` (L91–121), `fetchApiFootballEnrichment` (L144–177), `fetchTeamStats` (L179–188), `fetchH2H` (L214–225), `fetchInjuries` (L265–278), `fetchOdds` (L310–364), `fetchScorers` (L366–381).
- `lib/api/football-data.ts` — fallback adapter.
- `lib/analysis/ingestion/fixtures.ts` — `FIXTURE_WINDOW_HOURS = 48`, `fetchFixtures`, provider priority.
- `lib/analysis/ingestion/enrichment.ts` — `MAX_CONCURRENCY = 10`, `enrichFixtures`.
- `lib/analysis/ingestion/cache.ts` — `cachedProviderFetch`, TTL.
- `lib/analysis/ingestion/weather.ts` — Open-Meteo (free).
- `lib/api/retry.ts` — retry/quota/auth classification.
- `lib/api/circuit-breaker.ts` — threshold 5 / window 120 s / cooldown 60 s.
- `lib/redis.ts` — fails closed in production.
- `lib/analysis/run.ts` — lock `analysis:daily:{day}` ex 600; idempotency.
- `lib/analysis/engine.ts` + `lib/analysis/markets/*` — 10-market engine.
- `lib/analysis/defaults.json` — `dataSourcePriorities = ["api-football","football-data"]`.
- Official pricing: `https://www.api-football.com/pricing/` (accessed 2026-11-22) — Free $0/100 per day; Pro $19/7,500 per day.
- Official docs: `https://www.api-football.com/documentation-v3` (accessed 2026-11-22) — response headers `x-ratelimit-requests-limit`, `x-ratelimit-requests-remaining`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`; account consumption counters (`requests.current` / `requests.limit_day`).

**Not yet verified through live provider measurement:** real fixture distribution, real cache hit rate, real retry/429 frequency, actual per-run counters, and current-season entitlement on a paid key.
