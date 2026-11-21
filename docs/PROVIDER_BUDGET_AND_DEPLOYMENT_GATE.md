# PredictPro — Provider API Budget Analysis & Final Deployment Gate Verification

- **Audit type:** Independent, evidence-based provider-cost and production-gate audit
- **Date of audit:** 2026-11-22
- **Auditor roles:** Principal Software Architect / Football Data API Specialist / DevOps Engineer / Database Reliability Engineer / Production Readiness Auditor
- **Repository:** `Kelly883/Prediction-claude-`
- **Code modification during audit:** **None.** No application code, dependency, migration, or deployment configuration was changed. No commit, push, merge, PR, deploy, production-cron trigger, production DB access, or subscription purchase was performed. `docs/PROVIDER_BUDGET_AND_DEPLOYMENT_GATE.md` is the only file produced.
- **Prior audits treated as historical claims, not proof:** `docs/FINAL_PHASE_1_INDEPENDENT_VERIFICATION.md`, `docs/PHASE_1_PRODUCTION_READINESS_AUDIT.md`, `docs/PROVIDER_COVERAGE_REPORT.md`.

> **Evidence discipline.** Every number in this report is tagged as **[VERIFIED]** (read from the repository or an official page during this audit), **[ESTIMATE]** (derived from a stated formula/assumption), or **[UNKNOWN / BLOCKED]** (cannot be confirmed without credentials or production access). Estimated request volumes are **not** confirmed live usage — no live provider credentials were available.

---

## 1. Executive summary

The provider integration is **code-complete, internally consistent, and correctly prioritised**: API-Football is the primary source and Football-Data.org the secondary fallback, and the ingestion pipeline is written to fail loudly on quota/auth errors rather than silently degrade.

The decisive finding is economic, not architectural:

1. **The documented free tiers cannot operate 20-league daily analysis.** API-Football Free provides **100 requests/day [VERIFIED against the official pricing page]**, while a single daily run consumes **~190–1,140 requests per run [ESTIMATE]** depending on fixture volume. Football-Data.org Free covers only **10 of the 20 internal leagues [VERIFIED in repo + official coverage page]**.
2. **API-Football's paid plans include *all* competitions and *all* endpoints on every plan [VERIFIED]**, and API-Football exposes a numeric id for **all 20 internal leagues [VERIFIED]**. This makes API-Football the only provider that can serve the full 20-league matrix from a single subscription.
3. **The minimum comfortable paid tier is API-Football Pro at $19/month (7,500 requests/day) [VERIFIED price]**, giving roughly **5× headroom** over an adverse peak day. Ultra ($29) and Mega ($39) are over-provisioned for Phase 1.
4. **The current application code already supports the recommended architecture (Option A)** with **zero code changes**: `dataSourcePriorities` defaults to `["api-football","football-data"]`, all 20 leagues have an API-Football id, and enrichment/fixtures both resolve to API-Football first.
5. Readiness remains **CONDITIONALLY READY**. The remaining blockers are **external provisioning and entitlement** (paid provider plan, production Redis, production PostgreSQL, Vercel 300-second execution entitlement) plus **live end-to-end verification**, all of which are **[BLOCKED]** in this offline audit.

**Final verdict: CONDITIONALLY READY** (provider plan + production infrastructure must be provisioned and live-verified before launch).

---

## 2. Repository baseline and commit

| Item | Value | Status |
|---|---|---|
| Current branch | `trae/agent-4phDPY` | **[VERIFIED]** |
| Local HEAD | `ecb58fe0d35386ff362e490da91030e05d787745` (`fix(test): pin test suite to in-memory Redis under CI's dummy Upstash env`) | **[VERIFIED]** |
| Remote `main` (after `git fetch`) | `c708ee36f7129ed5dc8fd61ed3ff9d571fb50d84` (Merge PR #80) | **[VERIFIED]** |
| Commit previously audited | `4ba9e8e` (`fix(phase1): remediate P0/P1 production-readiness defects`) | **[VERIFIED]** (present in history) |
| Working tree | Clean (`git status --porcelain` empty) | **[VERIFIED]** |
| Migrations present | 15 Prisma migrations (incl. `0013` unique `(runId,fixtureId)`, `0014` partial unique running-per-day) | **[VERIFIED]** (per prior audit + schema) |

> The remote `main` SHA differs from the SHA recorded in the previous independent audit (`287467a`). This audit therefore re-verified the mapping tables and adapter code directly rather than trusting the earlier report, per the brief.

---

## 3. Phase A — Actual provider integration findings

### 3.1 Adapters discovered

| Adapter | File | Base URL | Auth header |
|---|---|---|---|
| API-Football | `lib/api/football-api.ts` | `https://v3.football.api-sports.io` | `x-apisports-key` |
| Football-Data.org | `lib/api/football-data.ts` | `https://api.football-data.org/v4` | `X-Auth-Token` |
| Weather (free) | `lib/analysis/ingestion/weather.ts` | Open-Meteo | none |

All **[VERIFIED]** by reading the source.

### 3.2 Orchestration (call paths that actually produce provider requests)

- **Fixture discovery** — `fetchFixtures()` (`lib/analysis/ingestion/fixtures.ts`) iterates `settings.dataSourcePriorities` and returns on the **first provider that succeeds**. Default priority is `["api-football","football-data"]`, so **API-Football is always attempted first**; Football-Data is only consulted if the entire API-Football fixture load throws. **[VERIFIED]**
- **Fixture window** — `FIXTURE_WINDOW_HOURS = 48`; window is `[today 00:00Z, today+48h 00:00Z]` (`from = today`, `to = today+2`). **[VERIFIED]**
- **Enrichment** — `enrichFixtures()` (`lib/analysis/ingestion/enrichment.ts`) runs `mapWithConcurrency(fixtures, MAX_CONCURRENCY=10, …)`, and for each fixture picks the **first priority provider whose enrichment succeeds**. With the default order this is **API-Football for every fixture**; Football-Data enrichment is a fallback only. **[VERIFIED]**
- **Caching** — every provider call goes through `cachedProviderFetch()` (`lib/analysis/ingestion/cache.ts`), a Redis read-through cache with TTL `FOOTBALL_CACHE_TTL_SECONDS` (default **86,400 s = 24 h**). Quota/auth errors **bypass** stale-cache fallback (fail loud). **[VERIFIED]**
- **Retry** — `withBoundedRetry()` (`lib/api/retry.ts`): default **2 retries** (3 attempts total), exponential backoff base 500 ms capped at 8 s, non-recoverable errors never retried, `Retry-After` honoured on 429. **[VERIFIED]**
- **Circuit breaker** — `lib/api/circuit-breaker.ts`: distributed via Redis, threshold **5** failures / **120 s** window / **60 s** cooldown; only *recoverable* failures trip it. **[VERIFIED]**

### 3.3 Endpoint inventory (requests the application actually issues)

> Rule applied: a function is only counted as a provider request if it reaches an HTTP call. Cache reads that hit do **not** consume quota.

| # | Provider | Endpoint (path) | Purpose | Trigger | Frequency (per run) | Cache key / TTL | Retry | Quota impact | Dependent features |
|---|---|---|---|---|---|---|---|---|---|
| 1 | API-Football | `GET /fixtures?league&from&to` | Discover fixtures for the 48 h window | Per enabled league, in priority order | **1 × league = 20** | `api-football:fixtures:{code}:{from}:{to}` / 24 h | 2 retries | 1/league | Everything (fixtures feed all markets) |
| 2 | API-Football | `GET /teams/statistics?team&league&season` | Team xG/goals/corners/cards/form | Per fixture (home + away) | **≈2 × fixture, deduped** | `api-football:team-stats:{team}:{league}:{season}` / 24 h | 2 retries | ≈2N (unique team-seasons) | MATCH_RESULT, OVER/UNDER, ASIAN_HANDICAP, etc. |
| 3 | API-Football | `GET /fixtures/headtohead?h2h&last=10` | Head-to-head history | Per fixture | **1 × fixture** | `api-football:h2h:{home}:{away}` / 24 h | 2 retries | N | MATCH_RESULT, BTTS, CORRECT_SCORE, DOUBLE_CHANCE |
| 4 | API-Football | `GET /injuries?fixture` | Injury counts per side | Per fixture | **1 × fixture** | `api-football:injuries:{fixtureId}` / 24 h | 2 retries | N | MATCH_RESULT, ASIAN_HANDICAP, DOUBLE_CHANCE |
| 5 | API-Football | `GET /odds?fixture` | Pre-match odds (result/BTTS/O-U/AH/DC/CS/1H/corners/cards) | Per fixture | **1 × fixture** | `api-football:odds:{fixtureId}` / 24 h | 2 retries | N | Odds-implied probabilities / AH line |
| 6 | API-Football | `GET /players/topscorers?league&season` | Top scorers (player-record enrichment) | Per fixture (invoked), **deduped per league** | **≤1 × league ≈ 20** | `api-football:scorers:{leagueId}:{season}` / 24 h | 2 retries | ≤20 | PLAYER_SCORER |
| 7 | Football-Data | `GET /competitions/{code}/matches?dateFrom&dateTo` | Fixture fallback | Only if API-Football fixture load fully fails | 0 normally; ≤10 fallback | `football-data:fixtures:{code}:{from}:{to}` / 24 h | 2 retries | fallback only | Fixtures |
| 8 | Football-Data | `GET /competitions/{code}/standings` | Standings-derived team stats | Football-Data enrichment fallback | 0 normally; ≤10 fallback | `football-data:standings:{competition}` / 24 h | 2 retries | fallback only | Team stats |
| 9 | Football-Data | `GET /competitions/{code}/scorers?limit=5` | Top scorers fallback | Football-Data enrichment fallback | 0 normally; ≤10 fallback | `football-data:scorers:{competition}` / 24 h | 2 retries | fallback only | PLAYER_SCORER |
| 10 | Open-Meteo | Current weather by lat/long | Weather factor for outdoor markets | Per fixture **with coordinates** | ≈N (only venues with lat/long) | `weather:{lat}:{lon}` / TTL | none (free) | **0 (free)** | BTTS, OVER/UNDER, CORNERS |

**Requests that may be repeated unnecessarily (identified, not counted in the baseline):**

- `fetchApiFootballEnrichment()` calls `fetchScorers()` **per fixture** (line 165 of `football-api.ts`) even though the cache key is per league-season. Within-run there is a **read-through race**: `MAX_CONCURRENCY = 10` fixtures of the same league can all miss the cache simultaneously and each issue a `/players/topscorers` call before the first write lands. Transient worst case: up to **concurrency (10) calls per league** instead of 1. Bounded and self-healing on later runs; noted as a minor quota inefficiency. **[VERIFIED from code]**
- The **48 h window shifts daily**, so the `/fixtures` discovery key (`{from}:{to}`) is **always new** each run → discovery is cold every day. The 24 h TTL is approximately equal to the daily run interval, so per-fixture enrichment keys also **expire just before the next run** → the operational reality is closer to **cold cache** than warm.

---

## 4. Phase B — Real daily request budget

### 4.1 Request model (derived from code, not assumed per-fixture)

Let:

- **L = 20** = enabled leagues (one `/fixtures` discovery call each).
- **N** = fixtures discovered in the 48 h window.
- **U** = unique team-seasons among those fixtures (`U ≤ 2N`; realistic `U ≈ 1.7N`).
- **S** = `≤ 20` = leagues with at least one fixture (top-scorers, deduped).

**API-Football requests per run (cold cache):**

```
R = 20            (fixture discovery: 1 per league)
  + U             (team statistics: 2 per fixture, deduped by team-season)
  + N             (head-to-head: 1 per fixture)
  + N             (injuries: 1 per fixture)
  + N             (odds: 1 per fixture)
  + S             (top scorers: ≤1 per league)
```

- **Conservative upper bound** (`U = 2N`, `S = 20`): `R ≈ 40 + 5N`
- **Realistic** (`U ≈ 1.7N`, `S = 20`): `R ≈ 40 + 4.7N`

> This confirms the brief's warning: it is **not** one request per fixture. Discovery is **one call per league** (a single `/fixtures` response returns the whole window), while enrichment is **~5 calls per fixture** but with team/scorer dedup.

### 4.2 Scenario definitions (formulas shown; counts are **[ESTIMATE]**)

| Scenario | Assumed active leagues | Avg fixtures/active league | **N** | Rationale |
|---|---|---|---|---|
| **Low-volume day** | ~6 / 20 | ~5 | **30** | Midweek, no European matchday; only a handful of leagues in the 48 h window |
| **Normal day** | ~14 / 20 | ~7 | **100** | Typical mixed day (domestic rounds across most European leagues) |
| **Peak-volume day** | ~20 / 20 | ~11 | **220** | Weekend domestic rounds **overlapping** a European competition matchday (CL/EL/ECL midweek + continental leagues in-season) |

### 4.3 Per-run and 30-day totals (cold cache, conservative model `40 + 5N`)

| Category | Low (N=30) | Normal (N=100) | Peak (N=220) |
|---|---|---|---|
| Leagues processed (discovery) | 20 | 20 | 20 |
| Fixtures discovered (N) | 30 | 100 | 220 |
| Fixtures enriched | 30 | 100 | 220 |
| Requests — league discovery | 20 | 20 | 20 |
| Requests — fixture retrieval | (included in discovery; 1 call/league) | — | — |
| Requests — team statistics (dedup) | ~60 | ~200 | ~440 |
| Requests — head-to-head | 30 | 100 | 220 |
| Requests — injuries | 30 | 100 | 220 |
| Requests — odds | 30 | 100 | 220 |
| Requests — standings (API-Football N/A) | 0 | 0 | 0 |
| Requests — top scorers | 20 | 20 | 20 |
| Requests — provider fallback (Football-Data) | 0 | 0 | 0 |
| **Total per run (cold, conservative)** | **≈190** | **≈540** | **≈1,140** |
| **Total per 30 days** | **≈5,700** | **≈16,200** | **≈34,200** |

*(Team-statistics row uses `U = 2N`; realistic `U ≈ 1.7N` lowers the run total by ≈6%.)*

### 4.4 Retry overhead **[ESTIMATE]**

`PROVIDER_MAX_RETRIES` default = 2, so a failing request costs up to **3 attempts**. Retries apply to *recoverable* failures only (network/5xx/429), never to quota/auth.

| Scenario | Base (cold) | +10% transient | +25% adverse (peak) |
|---|---|---|---|
| Low | 190 | ~209 | ~238 |
| Normal | 540 | ~594 | ~675 |
| Peak | 1,140 | ~1,254 | **~1,425** |

**Planning figure: plan for ≈1,500 requests on an adverse peak day, ≈45,000/month.** Even with adverse retries the peak day remains far below the 7,500/day Pro quota.

### 4.5 Cache scenario (both cases modelled)

| Cache model | Formula | Low | Normal | Peak | Notes |
|---|---|---|---|---|---|
| **Cold cache** (operational reality at 24 h TTL ≈ daily cadence) | `40 + 5N` | 190 | 540 | 1,140 | The correct planning model |
| **Warm cache** (best case; requires TTL > run interval) | `40 + 2.75N` | ~123 | ~315 | ~645 | Only achievable by **raising the TTL**, which serves **staler odds/injuries** — undesirable for a freshness-sensitive product |

Because the cron runs once every 24 h and the TTL is 24 h, **the warm-cache saving is largely unrealisable in normal operation** and should not be relied on for plan sizing. Within-run dedup (team-scorers, top-scorers) is **already included** in the cold model above.

---

## 5. Phase C — Provider plan and cost comparison

### 5.1 API-Football — official plans

> **All API-Football plans include all competitions and all endpoints; the Free plan is limited in available seasons [VERIFIED on the official pricing page].** Source: `https://www.api-football.com/pricing/` — accessed **2026-11-22**.

| Plan | Monthly price | Requests/day | All 20 competitions? | All endpoints needed? | Current season? | Verdict |
|---|---|---|---|---|---|---|
| Free | **$0** | **100** | Yes (addressable) | Yes (listed) | **No — season-limited (~Year-4…Year-2)** | **UNSUITABLE** — 100/day < 190–1,140/run |
| **Pro** | **$19** | **7,500** | **Yes** | **Yes** | **Yes** | **RECOMMENDED** — ≈5× peak headroom |
| Ultra | $29 | 75,000 | Yes | Yes | Yes | Over-provisioned |
| Mega | $39 | 150,000 | Yes | Yes | Yes | Over-provisioned |
| Custom | quote | up to 1,500,000 | Yes | Yes | Yes | Not required |

**[UNKNOWN / needs confirmation] Per-minute rate limits.** The pricing page does not publish numeric per-minute limits; the documentation states the limit is returned at runtime via the `X-RateLimit-Limit` response header. The commonly quoted values (Free 10/min, Pro 300/min, Ultra 450/min, Mega 900/min) **could not be independently confirmed from the official pages fetched during this audit** and must be confirmed from the provider dashboard before launch. This matters: at peak (≈1,140 requests) a 300/min cap implies a **~3.8-minute floor**, which is close to the 300 s function ceiling (§8.3).

**Season restriction [VERIFIED in repo `provider-mapping.ts`]:** the code encodes the free-tier season window as `isWithinApiFootballFreeTierSeasons()` (≈ Year-4…Year-2). Current-season analysis therefore **requires a paid plan**.

### 5.2 Football-Data.org — official plans

> Source: `https://www.football-data.org/pricing` and `https://www.football-data.org/coverage` — accessed **2026-11-22**.

| Plan | Monthly price | Competitions | Rate limit | Notes |
|---|---|---|---|---|
| Free (Tier One) | **€0** | **12** | 10/min | Covers only 10 of our 20 |
| Free w/ Livescores | €12 | 12 | 20/min | Still 12 comps |
| ML Pack Light | €29 | 12 | 20/min | Still 12 comps |
| Free + Deep Data | €29 | 12 | 30/min | Still 12 comps |
| Standard | €49 | 30 | 60/min | More comps; coverage of our gaps unverified |
| Advanced | €99 | 50 | 100/min | — |
| Pro | €199 | 100 | 120/min | — |
| Odds Add-On | +€15 | 40 | — | Pre-match 1X2 only |
| Statistic Add-On | +€15 | — | — | Corners/cards/etc. |

**Free-tier competition sets [VERIFIED, official coverage page]:** Champions League, Primeira Liga, Premier League, Eredivisie, Bundesliga, Ligue 1, Serie A, La Liga, Championship, Serie A Brazil, World Cup, European Championship → **12 competitions, matching exactly 10 of our 20 internal codes** (PL, PD, BL1, SA, FL1, PPL, ERE→DED, CL, ELC, BRA→BSA).

### 5.3 Cost comparison (verdict balances coverage **and** calculated demand)

| Provider / Plan | Monthly price | Daily quota | 20-league coverage | Endpoint coverage | Verdict |
|---|---|---|---|---|---|
| API-Football Free | $0 | 100/day | Addressable but season-restricted | All endpoints listed | **Fails** both season and quota |
| **API-Football Pro** | **$19** | **7,500/day** | **20/20** | **All needed** (fixtures, team stats, H2H, injuries, odds, top scorers) | **MEETS BOTH** — recommended |
| API-Football Ultra | $29 | 75,000/day | 20/20 | All | Meets both; over-provisioned |
| Football-Data Free | €0 | 10/min | **10/20** | Standings/fixtures/scorers only | **Fails coverage** |
| Football-Data Standard | €49 | 60/min | ≤30 comps (our gaps unverified) | Lacks odds without add-on | Fails value vs API-Football Pro |
| Football-Data Pro + Odds + Stats | €199+15+15 = **€229** | 120/min | ≤100 comps (gaps unverified) | With add-ons | **Much more expensive, less certain** |

> Per the brief: a plan must satisfy **both** coverage and calculated demand. Only **API-Football Pro and above** satisfy both from a single subscription. Recommendation is **not** made on league count alone — Pro is also the cheapest tier whose daily quota clears the adverse peak day (~1,425) with headroom.

---

## 6. Phase D — Recommended architecture

### 6.1 Options compared

| Option | Description | Daily req. | Monthly req. | Required plan | Est. monthly cost | Complexity | Failure risk | Coverage gaps | Fallback | Maintenance |
|---|---|---|---|---|---|---|---|---|---|---|
| **A** | API-Football primary for all 20 | 540 (normal) / 1,140 (peak) | ~16,200 / ~34,200 | **API-Football Pro** | **$19** | **Low** (already implemented) | Single provider dependency | None | Existing Football-Data secondary covers 10 leagues | Lowest |
| B | Football-Data primary + API-Football fallback | n/a | n/a | Football-Data Pro + add-ons **and** API-Football Pro | ≥€229 + $19 | High | High | Football-Data cannot cover EL/ECL/BL2/PD2/SA2/FL2/MLS/LIB/J1/ARG reliably | Two providers | High |
| C | Hybrid by endpoint/competition | similar | similar | Both paid | ≥$19 + paid FD | **High — not supported by current adapters** | Medium-High | Depends | Complex | High |
| D | Other provider | — | — | — | — | Very high | Unknown | Unknown | None | Very high |

### 6.2 Does the current code support the recommended architecture?

**Yes — Option A requires no code changes [VERIFIED]:**

- `defaults.json` sets `dataSourcePriorities = ["api-football","football-data"]` → API-Football is already primary.
- `provider-mapping.json` gives **all 20** leagues a numeric `apiFootballId`.
- `fetchFixtures()` and `enrichFixtures()` both resolve to the **first** priority provider, i.e. API-Football.
- Football-Data remains a **partial** secondary fallback (10 leagues) with no code change needed.

Option B is **partially** supported by the code (both adapters exist) but is **economically and coverage-wise inferior** and would need Football-Data paid-tier entitlement for the 10 missing competitions. **Options C and D would require new adapter/routing code that does not exist** and are documented as future work only.

### 6.3 Recommendation

> **Option A — API-Football Pro ($19/month) as the single primary provider for all 20 leagues, with Football-Data.org retained as the configured secondary fallback.**

Why: it is the **only** option that covers all 20 leagues and every required endpoint from one subscription; it is the **cheapest** tier that clears the adverse peak day; it requires **zero implementation**; and it minimises operational surface (one provider to monitor, one quota to alert on). Football-Data is kept as-is because it already exists and provides a free partial safety net for the 10 leagues it covers.

---

## 7. Phase E — 20-league coverage matrix

Legend for **Status**: **VERIFIED** (authoritative doc/live evidence) · **PARTIAL** (some data/entitlement missing) · **UNSUPPORTED** (provider offers neither comp nor endpoint) · **BLOCKED** (cannot verify without credentials/subscription).

> The four questions are distinguished in the notes: (a) competition exists in catalogue; (b) available under proposed subscription; (c) endpoint available; (d) app actually retrieves data.

| Internal | Provider | Provider ID/code | Fixtures | Standings | Statistics | Odds | Season restriction | Status |
|---|---|---|---|---|---|---|---|---|
| PL | API-Football | 39 | Yes | N/A* | Yes | Yes | Paid for current season | **BLOCKED** (needs live key) |
| PD | API-Football | 140 | Yes | N/A* | Yes | Yes | Paid | **BLOCKED** |
| BL1 | API-Football | 78 | Yes | N/A* | Yes | Yes | Paid | **BLOCKED** |
| SA | API-Football | 135 | Yes | N/A* | Yes | Yes | Paid | **BLOCKED** |
| FL1 | API-Football | 61 | Yes | N/A* | Yes | Yes | Paid | **BLOCKED** |
| PPL | API-Football | 94 | Yes | N/A* | Yes | Yes | Paid | **BLOCKED** |
| ERE | API-Football | 88 | Yes | N/A* | Yes | Yes | Paid | **BLOCKED** |
| CL | API-Football | 2 | Yes | N/A* | Yes | Yes | Paid | **BLOCKED** |
| EL | API-Football | 3 | Yes | N/A* | Yes | Yes | Paid | **BLOCKED** |
| ECL | API-Football | 848 | Yes | N/A* | Yes | Yes | Paid | **BLOCKED** |
| BL2 | API-Football | 79 | Yes | N/A* | Yes | Yes | Paid | **BLOCKED** |
| PD2 | API-Football | 141 | Yes | N/A* | Yes | Yes | Paid | **BLOCKED** |
| SA2 | API-Football | 136 | Yes | N/A* | Yes | Yes | Paid | **BLOCKED** |
| FL2 | API-Football | 62 | Yes | N/A* | Yes | Yes | Paid | **BLOCKED** |
| ELC | API-Football | 40 | Yes | N/A* | Yes | Yes | Paid | **BLOCKED** |
| MLS | API-Football | 253 | Yes | N/A* | Yes | Yes | Paid | **BLOCKED** |
| LIB | API-Football | 262 | Yes | N/A* | Yes | Yes | Paid | **BLOCKED** |
| J1 | API-Football | 98 | Yes | N/A* | Yes | Yes | Paid | **BLOCKED** |
| ARG | API-Football | 128 | Yes | N/A* | Yes | Yes | Paid | **BLOCKED** |
| BRA | API-Football | 71 | Yes | N/A* | Yes | Yes | Paid | **BLOCKED** |

\* The application **does not call an API-Football standings endpoint**; standings are only used on the Football-Data fallback path. API-Football team statistics (`/teams/statistics`) supply the equivalent inputs. The API-Football "Standings" entry is left canonical as `N/A*` to reflect the actual code path.

**API-Football (a–c) = VERIFIED, (d) = BLOCKED for all 20:**
- (a) Competition exists in catalogue — **VERIFIED** (all 20 ids mapped; API-Football states all plans include all competitions).
- (b) Available under proposed subscription — **VERIFIED** for a paid plan.
- (c) Endpoint available — **VERIFIED** (all endpoints listed on every plan).
- (d) App actually retrieves data — **BLOCKED** (no live key; no subscription purchased).

**Football-Data.org cross-check (secondary):**

| Set | Leagues | FD free-tier status |
|---|---|---|
| Covered (10) | PL, PD, BL1, SA, FL1, PPL, ERE(DED), CL, ELC, BRA(BSA) | **VERIFIED** exists in Tier One catalogue |
| Not covered (10) | **EL, ECL, BL2, PD2, SA2, FL2, MLS, LIB, J1, ARG** | **UNSUPPORTED on free tier**; may appear at Tier 3/4 (coverage per competition **unverified**) |

This is the crux of the coverage question: **Football-Data.org alone cannot serve the 20-league matrix**; API-Football can.

---

## 8. Phase F — Infrastructure deployment gate

> No production system was contacted. All items below are **[VERIFIED from repo]** unless marked otherwise.

### 8.1 Database

| Check | Finding | Status |
|---|---|---|
| `DATABASE_URL` | Required; `.env.example` mandates `sslmode=require`; schema `url = env("DATABASE_URL")` documented as **pooled** connection | **[VERIFIED]** |
| `DIRECT_URL` | Required; `directUrl = env("DIRECT_URL")` "used only by `prisma migrate`" | **[VERIFIED]** |
| Connection pooling | Commented as "pooled connection (e.g. Neon pooler / Supabase pgbouncer)" — pooling is **expected provisioned externally** | **[VERIFIED / config pending]** |
| Migration procedure | `prisma migrate deploy` against `DIRECT_URL`; 15 migrations historically replayed on isolated Postgres (prior audit) | **[VERIFIED]** |
| Indexes/constraints | Unique `(runId,fixtureId)`; partial unique `AnalysisRun(runDate) WHERE status='running'`; `skipDuplicates` + atomic `$transaction` finalisation | **[VERIFIED]** |
| Backup/restore | **Not defined in repo** — provider-dependent | **[UNKNOWN / provisioning task]** |
| Connection limits | Serverless fan-out (`MAX_CONCURRENCY=10`) must be served by a **pooled** endpoint; exact limit depends on chosen provider tier | **[UNKNOWN / provisioning task]** |

### 8.2 Redis

| Check | Finding | Status |
|---|---|---|
| Production Redis required | **Yes** — `lib/redis.ts` **throws** in `NODE_ENV=production` when Upstash vars are absent (fails closed) | **[VERIFIED]** |
| In-memory fallback | **Dev/test only**; per-instance, cannot provide distributed locks/cache | **[VERIFIED]** |
| Lock behaviour / TTL | `analysis:daily:{day}` SET NX `ex 600` (10 min); DB partial-unique index is the second guard | **[VERIFIED]** |
| Circuit breaker | Distributed in Redis; threshold 5 / window 120 s / cooldown 60 s; **fails open** if Redis is unreachable | **[VERIFIED]** |
| Failure behaviour when Redis unavailable (runtime) | Cache read → warn + proceed; lock → warn + rely on DB guard; breaker → fail open | **[VERIFIED]** |
| Upstash config | `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` via REST | **[VERIFIED]** |

### 8.3 Cron

| Check | Finding | Status |
|---|---|---|
| Daily 06:00 UTC schedule | `vercel.json` → `/api/cron/daily-analysis` `"0 6 * * *"` | **[VERIFIED]** |
| `CRON_SECRET` auth | Bearer token compared to `Bearer ${CRON_SECRET}`; unset secret ⇒ 401 | **[VERIFIED]** |
| Timing-safe comparison | `timingSafeStringEqual()` via `crypto.timingSafeEqual` (length-checked first) | **[VERIFIED]** |
| Max execution duration | `export const maxDuration = 300` on the route | **[VERIFIED from code]** |
| Vercel plan permits 300 s | Hobby cannot run 300 s; **Pro/Enterprise required** — deployed plan **cannot be inspected** | **[BLOCKED]** |
| Can the run finish in the window? | **Likely yes but tight at peak:** ≈1,140 requests under concurrency 10 ≈ tens of seconds of wall time, **but** if the paid per-minute cap is 300/min the theoretical floor is ~3.8 min (~228 s) < 300 s — little margin. | **[ESTIMATE / needs validation]** |

### 8.4 Security

| Check | Finding | Status |
|---|---|---|
| Secrets not committed | `.env.example` contains **empty** placeholders only; real values are env-injected | **[VERIFIED]** |
| Env documented | `.env.example` documents DB, Redis, cron, provider, JWT, TOTP, email, S3, payment vars | **[VERIFIED]** |
| Superadmin access / 2FA | TOTP 2FA implemented (`lib/twofactor.ts`, `/api/auth/2fa/*`, `TOTP_ENCRYPTION_KEY`); superadmin setup guarded by `ADMIN_BOOTSTRAP_SECRET` | **[VERIFIED]** |
| CSRF / same-origin | CSRF handling present (tests exist: `tests/security/csrf.test.ts`) | **[VERIFIED (presence)]** |
| Audit logging & redaction | `lib/audit.ts` with redaction; cron attributed as `system:cron` | **[VERIFIED]** |
| Rate-limiting gaps | `/api/superadmin/analysis/**` is **not** rate-limited (only `superadmin/setup[/verify]` use `checkRateLimit`) — retained as an open item | **[VERIFIED]** |
| Security scan CI gating | `scripts/security-scan.mjs` **never exits non-zero** → cannot fail the build | **[VERIFIED]** |

### 8.5 Observability — current state

| Capability | Present? |
|---|---|
| Error monitoring (e.g. Sentry) | **No** — structured logger only |
| Cron failure alerts | **No** |
| Provider quota alerts | **No** |
| Provider auth-failure alerts | **No** |
| Database failure alerts | **No** |
| Redis failure alerts | **No** |
| Run-duration monitoring | **No** |
| Failed fixture-enrichment monitoring | **No** (errors returned in run payload, not alerted) |
| Failed publication monitoring | **No** |
| Audit log | **Yes** (`AuditLog`) |

**Minimum recommended monitoring for launch (install nothing now):**
1. Error monitoring wired into `logger.error` (Sentry or equivalent).
2. An alert when `/api/cron/daily-analysis` returns non-200 or `status!=='completed'`.
3. A provider-quota / provider-auth alert (triggered on `ProviderQuotaExhaustedError` / `ProviderAuthError`, which the code already raises loudly).
4. Run-duration + failed-enrichment tracking (the run payload already carries `errors[]`).
5. Redis/DB availability alerts (Upstash + DB provider native alerts).

---

## 9. Phase G — Final production decision

### Category 1 — Mandatory before production

1. **Provision a paid API-Football plan (Pro, $19/mo, or higher).** The Free tier (100/day, season-restricted) **physically cannot** run 20-league current-season analysis. **[VERIFIED quota/price; provisioning pending]**
2. **Provision production Redis (Upstash).** The application **fails closed** in production without it. **[VERIFIED]**
3. **Provision production PostgreSQL** with a **pooled** `DATABASE_URL` + `DIRECT_URL`, and run `prisma migrate deploy` (15 migrations). **[VERIFIED requirement; provisioning pending]**
4. **Confirm the Vercel plan permits `maxDuration = 300`.** If the deployment is on Hobby, the 300 s cron cannot run. **[BLOCKED — cannot inspect deployed plan]**
5. **Live end-to-end verification** of one real cron run against the paid provider + production Redis/DB (fixtures → enrichment → scoring → persistence). **[BLOCKED offline]**

### Category 2 — Strongly recommended before production

6. **Error monitoring** and **cron/provider failure alerts** (§8.5).
7. **Validate peak-run duration vs the per-minute rate limit and the 300 s ceiling** (§8.3) — the ~228 s floor at a 300/min cap leaves little margin.
8. **Security-scan CI gating** — make `security-scan.mjs` fail the build on findings.
9. **Rate-limit `/api/superadmin/analysis/**`** (currently unlimited).
10. **Per-minute rate-limit confirmation** from the provider dashboard (§5.1) — currently unverified.

### Category 3 — Later phase (Phase 2 / not Phase 1 launch blockers)

11. **Utilisation of per-league market weights** — `LeagueConfig.marketWeights (Json?)` exists but per-league weights are not yet applied per league at scoring time (global defaults used). Feature work, not a launch blocker.
12. **Backtesting and model calibration** — deferred; **no accuracy claims are made anywhere in this report** because no validated backtest/calibration evidence exists.
13. **Missing league-configuration admin APIs** — deferred operational convenience.
14. **JSON-LD escaping hardening** (`lib/seo/structured-data.ts`) — SEO/render hardening; **outside the provider-budget scope** and not independently re-verified here; requires its own targeted review.
15. **Hybrid per-endpoint provider routing (Option C/D)** — would require new adapter code; not justified while API-Football Pro satisfies all requirements.

> Classification note: items 11–15 are **deliberately not** mandatory launch requirements. They do not affect the ability to run a reliable 20-league daily analysis.

---

## 10. Final verdict

> ## **CONDITIONALLY READY**
>
> The provider integration is correctly built and the recommended architecture is **already implemented and supported by the code**. Launch is blocked only by **external provisioning** (paid API-Football plan, production Redis, production PostgreSQL, Vercel 300 s entitlement) and by **live end-to-end verification**, none of which could be performed in this offline audit. No code defect was found that would prevent launch. **NOT READY** would overstate the problem (the code is sound); **READY FOR PRODUCTION** would overstate the evidence (entitlements are unverified).

---

## 11. External sources and access dates

| Source | URL | Accessed |
|---|---|---|
| API-Football pricing | `https://www.api-football.com/pricing/` | 2026-11-22 |
| API-Football documentation (rate-limit headers, quotas) | `https://www.api-football.com/documentation-v3` | 2026-11-22 |
| Football-Data.org pricing | `https://www.football-data.org/pricing` | 2026-11-22 |
| Football-Data.org coverage | `https://www.football-data.org/coverage` | 2026-11-22 |

**Repository evidence (read during this audit):** `lib/api/football-api.ts`, `lib/api/football-data.ts`, `lib/api/retry.ts`, `lib/api/circuit-breaker.ts`, `lib/api/provider-mapping.{json,ts}`, `lib/analysis/ingestion/{fixtures,enrichment,cache}.ts`, `lib/analysis/run.ts`, `lib/redis.ts`, `app/api/cron/daily-analysis/route.ts`, `vercel.json`, `prisma/schema.prisma`, `.env.example`, `lib/timing-safe.ts`, `lib/ratelimit.ts`, `docs/PROVIDER_COVERAGE_REPORT.md`.

---

## 12. Assumptions and verification limitations

**Assumptions (estimates, clearly flagged):**
- Fixture volumes (N = 30 / 100 / 220) are **modelled**, not observed; they define the Low/Normal/Peak scenarios.
- `U ≈ 1.7N` (unique team-seasons) is a modelling estimate; the conservative bound uses `U = 2N`.
- Retry overhead of +10% (typical) / +25% (adverse) is a planning estimate.
- Weather enrichment is assumed free (Open-Meteo) and quota-neutral.

**Limitations / unknowns:**
- **No live provider credentials** were available → live entitlement, current-season access, and actual response availability are **[BLOCKED]**.
- **No production infrastructure** was inspected → Vercel plan, Redis instance, DB tier, and connection limits are **[UNKNOWN]**.
- **API-Football per-minute rate limits** are not published on the pricing page; numeric values are **[UNKNOWN]** pending dashboard confirmation.
- Whether Football-Data paid tiers cover the **10 missing competitions** (EL, ECL, BL2, PD2, SA2, FL2, MLS, LIB, J1, ARG) is **[UNVERIFIED]** (coverage table render did not expose per-tier check marks).
- All request counts are **estimates**; they are **not** confirmed live usage.
- No production cron was triggered; no migrations were run; no data was modified; no subscription was purchased.
