# PredictPro — Phase 1 Data Completeness & Prediction Engine Audit

**Audit date:** 2026-11-22
**Repository:** `Kelly883/Prediction-claude-` (working tree, uncommitted remediation state)
**Audit type:** Read-only, evidence-based. **No application code, configuration, migrations, environment variables or dependencies were modified. No production cron was triggered and no live provider request was made.** No secret values are reproduced in this document.
**Auditor role:** Principal Football Data Engineer / Sports Prediction Systems Architect / Independent QA Auditor.

## Evidence labels used throughout

| Label | Meaning |
|---|---|
| **VERIFIED** | Confirmed by direct inspection of the named file + function in the working tree. |
| **CALCULATED** | Derived by arithmetic/trace over verified code (the arithmetic is shown). |
| **ESTIMATED** | Inferred consequence or order-of-magnitude judgement, explicitly not measured. |
| **NOT VERIFIED** | Cannot be confirmed without a live provider call or a captured provider fixture; treated as a risk, not a fact. |

> Scope note: this audit evaluates **data sufficiency and mapping correctness**, not predictive accuracy. **No accuracy/backtest claim is made** (no historical backtest evidence exists in the repository — confirmed by absence of any calibration/backtest artefact under `lib/analysis` and `docs`).

---

## 1. Executive summary

PredictPro's Phase 1 pipeline is structurally complete and defensively written: it discovers fixtures, enriches them, scores ten markets deterministically, gates picks behind a configurable model-score threshold, and routes everything through superadmin review before publishing. The orchestration, persistence, atomicity, authorization and audit-logging layers are sound (see `docs/PHASE_1_PRODUCTION_READINESS_AUDIT.md` Revision 2).

However, this audit finds a **systematic gap between what the prediction engine consumes and what the provider layer actually supplies**. The engine reads a rich `FixtureEnrichment` object of ~20 fields; the primary adapter (`lib/api/football-api.ts`) only ever populates five of them, and the fallback adapter (`lib/api/football-data.ts`) populates fewer still.

Headline findings (all VERIFIED unless stated):

1. **Engine-referenced factors that are never populated by any adapter.** `motivation`, `schedule`, `referee`, `pace`, `leagueAvgCorners`, `leagueAvgCards` are **read** by market modules but **written by no code path** — confirmed by repository-wide search (`motivation|schedule|referee|leagueAvgCorners|leagueAvgCards|pace` appears only in `lib/analysis/markets/**` and `lib/analysis/utils/normalization.ts`, never in `lib/api/**` or `lib/analysis/ingestion/**`). They therefore fall to their neutral defaults (50 / 3.5 / fallback) in every live run.
2. **`leagueAvgGoals` is populated only by the fallback adapter** (`lib/api/football-data.ts:162`), never by the primary API-Football adapter.
3. **`normalizeTeamStats` (`lib/api/football-api.ts:190`) cannot produce** `xgAgainst`, `firstHalfGoalsFor/Against`, `cornersAgainst`, `cardsAgainst`, `shotsAgainst` — the primary adapter never sets them (confirmed: these identifiers are only ever *read*, never written).
4. **`fetchInjuries` hardcodes `keyHome: 0, keyAway: 0`** (`lib/api/football-api.ts:277`), making the key-injury sub-factor inert.
5. **The "high-confidence" engine test does not exercise real provider output.** `tests/analysis-engine.test.ts` builds a hand-populated `strongEnrichment` containing exactly the fields the adapters cannot produce (`xgAgainst`, `firstHalfGoalsFor`, `leagueAvgCorners`, `leagueAvgCards`, `pace`, `motivation`, `schedule`, `referee`). The assertion `best.confidence >= 75` is therefore **not evidence that real data can reach the threshold**.
6. **`PLAYER_SCORER` is conceptually weak**: `players` is the league's season **top-five scorers** (`fetchScorers`, `lib/api/football-api.ts:366`), not players selected for *this* fixture; and `odds.playerScorer` is **never populated** by `fetchOdds`, so its persisted price is always the fabricated `1.91` default (`oddsOrDefault`, `lib/analysis/markets/shared.ts:34`).
7. **A fabricated `1.91` decimal is persisted as `bestOdds`** whenever real odds are absent — which is the common case for corners, cards, correct score, first half and player markets in many competitions.
8. **Football-Data.org fallback is triggered only by thrown errors, not by missing critical fields**, and it can supply only goals/form + a goals average — no H2H, no injuries, no odds, no xG, no corners/cards/first-half. Ten of twenty leagues have no fallback at all.

**Overall verdict: CONDITIONALLY READY — leaning to NOT READY for a subset of markets.** The safe, evidence-backed markets (Match Result, Double Chance, Correct Score, Over/Under, Asian Handicap, BTTS) can be published with clear limitations. The corners, cards, first-half and player markets rest substantially on neutral defaults or fabricated odds and should be restricted or disabled for Phase 1 (see §12).

---

## 2. Overall readiness verdict

| Dimension | Verdict | Basis |
|---|---|---|
| Pipeline orchestration, persistence, review, publishing | **READY** | VERIFIED: `lib/analysis/run.ts`, `app/api/superadmin/analysis/**`, `lib/analysis/persistence.ts`. |
| Engine determinism & structure | **READY** | VERIFIED: `lib/analysis/engine.ts:scoreFixture` always emits 10 ordered markets. |
| Data sufficiency for all 10 markets | **NOT READY** | Multiple markets run on permanently-neutral factors/fabricated odds (§4, §6). |
| Data sufficiency for the ~6 main markets | **CONDITIONALLY READY** | Conditional on a live-shape confirmation of `/teams/statistics` (§6.1, NOT VERIFIED). |
| 20-league provider coverage | **CONDITIONALLY READY** | API-Football 20/20 addressable; season entitlement on Free is a blocker (§5). |
| Confidence/threshold integrity | **CONDITIONALLY READY** | Evidence multiplier is conservative, but three markets are structurally under-evidenced (§7). |

Net: **CONDITIONALLY READY**.

---

## 3. Architecture and data-flow findings (Task 1)

The full pipeline is mapped below to exact files and functions (VERIFIED unless marked).

| # | Stage | File · function | Evidence |
|---|---|---|---|
| 1 | Scheduling | `vercel.json:12-14` | Cron `/api/cron/daily-analysis` at `0 6 * * *`. |
| 2 | Trigger / auth | `app/api/cron/daily-analysis/route.ts:isAuthorized` | Timing-safe `Bearer CRON_SECRET`; `GET`/`POST` → `runDailyAnalysis`. |
| 3 | Run lifecycle / idempotency | `lib/analysis/run.ts:runDailyAnalysis` | Same-day reuse of `running`/`completed` run; Redis lock `analysis:daily:${day}` (`nx`, `ex:600`); partial unique index catches races. |
| 4 | Settings load | `lib/analysis/run.ts:loadAnalysisSettings` → `config.ts:parseStoredConfigs` | Threshold, `marketWeights`, `dataSourcePriorities`. |
| 5 | League list | `lib/analysis/ingestion/fixtures.ts:getEnabledLeagues` | `LeagueConfig` where `isEnabled`. |
| 6 | Fixture discovery | `fixtures.ts:fetchFixtures` | Iterates `dataSourcePriorities`, `partitionByProviderSupport`, `loadFromProvider`, `dedupeFixtures` keyed `${source}:${id}`. Window `FIXTURE_WINDOW_HOURS = 48`. |
| 7 | Provider adapters (fixtures) | `lib/api/football-api.ts:fetchApiFootballFixtures`, `lib/api/football-data.ts:fetchFootballDataFixtures` | Per-league cache key `…:fixtures:${code}:${from}:${to}`. |
| 8 | Enrichment orchestration | `ingestion/enrichment.ts:enrichFixtures` | `mapWithConcurrency(…, MAX_CONCURRENCY=10, …)`; per fixture iterates providers, first success wins; then weather. |
| 9 | Provider adapters (enrichment) | `football-api.ts:fetchApiFootballEnrichment` (6 parallel calls); `football-data.ts:fetchFootballDataEnrichment` (2 parallel calls) | See §4/§9. |
| 10 | Cache | `ingestion/cache.ts:cachedProviderFetch` | `get → miss → loader() → set{ex:TTL}`; TTL `FOOTBALL_CACHE_TTL_SECONDS` default `86 400` (24 h). Stale fallback on non-quota/auth errors. **No single-flight lock.** |
| 11 | Scoring | `lib/analysis/engine.ts:scoreFixture` | Runs the 10 scorers in `MARKET_ORDER`, ranks by `confidence` then order index. |
| 12 | Market calculations | `lib/analysis/markets/*.ts` (10 modules) | See §4. |
| 13 | Confidence scoring | `lib/analysis/utils/confidence.ts:confidenceFromDirection` | `50 + |direction−50| · clamp(evidence,0,1)`. |
| 14 | Selection gate | `engine.ts:filterPicks` | `outcomes.filter(o => o.best.confidence >= threshold)` (inclusive `>=`), threshold 75. |
| 15 | Persistence | `persistence.ts:toPersistableResult` | zod validation (confidence 0–100 finite, factors ≥1, odds >0); throws on invalid. |
| 16 | Atomic write | `run.ts` `$transaction` | `analysisResult.createMany({skipDuplicates})` + run `completed` commit together. |
| 17 | Superadmin review | `app/api/superadmin/analysis/results/[id]/route.ts:PATCH` | `approved|dismissed`; dismissal requires reason; published picks immutable. |
| 18 | Publishing | `app/api/superadmin/analysis/results/[id]/publish/route.ts:POST` | Requires `status==='approved'`; creates `PredictionPost` + sets `published` in one transaction. |

**Verified structural strengths:** idempotency, atomic finalisation, entitlement exhausted ⇒ run fails loudly (`ProviderQuotaExhaustedError`/`ProviderAuthError` re-thrown at every layer), no fabricated analysis rows, publish requires human approval.

**Verified structural gap:** `LeagueConfig.marketWeights` (per-league weights column) is stored in the schema but **never read** by `scoreFixture` — all leagues share `AnalysisConfig.market_weights` / `defaults.json`. (VERIFIED: `engine.ts:23` reads only `settings.marketWeights`.)

---

## 4. Ten-market data requirements & coverage matrix (Task 2)

Legend for **Supplied?**: ✅ populated · ➖ partially populated · ❌ never populated.

### 4.1 Summary matrix

| # | Market (`MarketType`) | Key inputs the module reads | Primary endpoint(s) | Supplied by API-Football? | Missing ⇒ behaviour | Safe to publish? |
|---|---|---|---|---|---|---|
| 1 | `MATCH_RESULT` | attack, h2h, form, injuries, motivation, 1X2 odds | `/teams/statistics`, `/fixtures/headtohead`, `/injuries`, `/odds` | ➖ (attack⚠️, h2h✅, form✅, injuries counts✅, motivation❌, odds✅) | Factor → neutral 50; `homeAdvantage` hardcoded 62; `referee`/`matchResultProbability`/`h2hFirstHalf` hardcoded 50 | **Conditional** |
| 2 | `BTTS` | attack, conceded, h2h.bttsRate, weather, odds | `/teams/statistics`, `/headtohead`, `/odds`, Open-Meteo | ➖ (conceded via `goalsAgainst` not `xgAgainst`) | `conceded` falls to goals-against; h2h/weather neutral if absent | **Conditional** |
| 3 | `OVER_UNDER_2_5` | leagueAvgGoals, teamXg, pace, weather, h2h.over25Rate | `/teams/statistics`, `/headtohead`, `/odds` | ➖ (leagueAvgGoals❌ under primary, pace❌) | `leagueAvgGoals` & `pace` → neutral 50 | **Conditional** |
| 4 | `ASIAN_HANDICAP` | captured `odds.asianHandicap.line` | `/odds` | ➖ (line only when bookmaker supplies AH) | No captured line ⇒ **declines** ("No handicap", conf 50) | **Safe (self-declining)** |
| 5 | `DOUBLE_CHANCE` | Poisson home/away/draw + h2h, injuries | `/teams/statistics`, `/headtohead`, `/odds` | ✅ (Poisson from attack/defence) | Evidence from available fields only | **Conditional** |
| 6 | `CORRECT_SCORE` | Poisson scoreline, defence, h2h.over25Rate, weather | `/teams/statistics`, `/headtohead`, `/odds` | ✅ (with league-source guard) | League-source ⇒ evidence ×≤0.25 (guard present) | **Conditional** |
| 7 | `FIRST_HALF_RESULT` | firstHalfGoalsFor, h2h first-half, form, motivation, odds | `/teams/statistics`, `/headtohead`, `/odds` | ❌ first-half fields; ➖ approximation | `firstHalfGoalsFor` ⇒ `xgFor·0.45` **approximation**; h2hFirstHalf ⇒ `h2hHomeScore` | **Weak** |
| 8 | `TOTAL_CORNERS` | cornersFor, shotsFor, leagueAvgCorners, weather, odds | `/teams/statistics`, `/odds` | ➖ (corners⚠️ shape; leagueAvgCorners❌) | `leagueAvg` neutral; `setPieces` neutral if corners missing | **Weak** |
| 9 | `TOTAL_CARDS` | cardsFor, referee.cardsPerGame, rivalry, leagueAvgCards, stakes | `/teams/statistics`, `/headtohead`, `/odds` | ➖ (referee❌ w=0.35, leagueAvgCards❌, stakes❌) | Largest-weight factor (`referee`) **always neutral** | **Weak** |
| 10 | `PLAYER_SCORER` | top-5 league scorers, player odds | `/players/topscorers`, `/odds` | ➖ (scorers are league-wide; `odds.playerScorer`❌) | Empty ⇒ "Unavailable"; odds always fabricated 1.91 | **Weak** |

### 4.2 Per-market notes with citations

- **`MATCH_RESULT`** — `lib/analysis/markets/matchResult.ts:8`. Direction from `matchResultDirection` (`shared.ts:56`): `homeXgVsAwayXg` uses `xgFor ?? goalsFor`; `h2h`, `form`, `injuries` real; **`homeAdvantage: 62` hardcoded**, **`referee: 50`, `matchResultProbability: 50`, `h2hFirstHalf: 50` hardcoded**, `motivation`/`schedule` neutral (never populated). Draw confidence capped at 70 (`matchResult.ts:23`).
- **`BTTS`** — `btts.ts:7`. `bothConceded`/`defense` read `xgAgainst ?? goalsAgainst`; since `xgAgainst` is never set, this always uses `goalsAgainst` (present under primary for the current season). `h2hBtts` from `h2h.bttsRate`; `weather` from Open-Meteo.
- **`OVER_UNDER_2_5`** — `overUnder.ts:7`. `leagueAvgGoals` neutral under API-Football; `pace` always neutral (`valueOr(enrichment.pace, 50)`, `overUnder.ts:16`); `recentTotals` collapses to `undefined` when both xG absent (`|| undefined`, `overUnder.ts:11`) — a **single-sided xG can drive a full-strength direction** (see §7).
- **`ASIAN_HANDICAP`** — `asianHandicap.ts:23`. **Positively defensive:** synthesises a fair line but sets `hasEdge = hasCapturedLine && edge > 0.02` (`:40`); without a captured bookmaker line it returns `'No handicap'`, confidence 50 — a safe no-op.
- **`DOUBLE_CHANCE`** — `doubleChance.ts:17`. Derived from `buildScorelineModel` (`poisson.ts:98`); mathematically coherent (three options sum to 2). Confidence scales the Poisson probability by evidence.
- **`CORRECT_SCORE`** — `correctScore.ts:19`. Uses the **only explicit data-quality guard in the engine**: `evidenceWeight = model.expected.source === 'league' ? min(evidence, 0.25) : evidence` (`:42`), preventing a league-average-driven plateau from manufacturing confidence.
- **`FIRST_HALF_RESULT`** — `firstHalfResult.ts:7`. `firstHalfGoalsFor` never set ⇒ `xgFor·0.45` **approximation** (`:10-11`); `h2h.firstHalfHomeWins` never set ⇒ `h2hFirstHalf` falls back to `h2hHomeScore`.
- **`TOTAL_CORNERS`** — `totalCorners.ts:7`. `cornersFor` present **subject to the `/teams/statistics` shape risk** (§6.1); `leagueAvgCorners` neutral; `shotsFor` present (subject to same risk).
- **`TOTAL_CARDS`** — `totalCards.ts:7`. `referee.cardsPerGame` carries **weight 0.35** (`defaults.json:82`) and is **never populated** ⇒ the dominant factor is permanently neutral; `leagueAvgCards` and `stakes` (`motivation`) also never populated.
- **`PLAYER_SCORER`** — `playerScorer.ts:24`. `players` = `fetchScorers` = season **top-5 league scorers** (`football-api.ts:366-380`), not fixture participants; `odds.playerScorer` is **not constructed** by `fetchOdds` (`football-api.ts:320-363`) ⇒ `oddsOrDefault` always returns `1.91`.

---

## 5. Twenty-league coverage matrix (Task 4)

Provider *addressability* is uniform for API-Football (20/20) per `lib/api/provider-mapping.json` and `docs/PROVIDER_COVERAGE_REPORT.md`. The league-by-league differentiators are: (a) Football-Data fallback availability, (b) **current-season entitlement**, and (c) per-league odds/bookmaker availability.

| League | API-Football id | Football-Data code | FD fallback? | Fixtures | Team stats | H2H | Injuries | Odds | Scorers | Corners/Cards | 1st-half | Missing critical inputs | Safely generable markets |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PL | 39 | PL | ✅ | ✅ | ⚠️§6.1 | ✅ | counts | ✅ | league | ⚠️§6.1 | ❌approx | motivation/schedule/referee/pace | 1X2, DC, CS, O/U, AH, BTTS |
| PD | 140 | PD | ✅ | ✅ | ⚠️ | ✅ | counts | ✅ | league | ⚠️ | ❌approx | as above | same |
| BL1 | 78 | BL1 | ✅ | ✅ | ⚠️ | ✅ | counts | ✅ | league | ⚠️ | ❌approx | as above | same |
| SA | 135 | SA | ✅ | ✅ | ⚠️ | ✅ | counts | ✅ | league | ⚠️ | ❌approx | as above | same |
| FL1 | 61 | FL1 | ✅ | ✅ | ⚠️ | ✅ | counts | ✅ | league | ⚠️ | ❌approx | as above | same |
| PPL | 94 | PPL | ✅ | ✅ | ⚠️ | ✅ | counts | ⚠️ | league | ⚠️ | ❌approx | as above + thinner odds | same (odds-thin) |
| ERE | 88 | DED | ✅ | ✅ | ⚠️ | ✅ | counts | ⚠️ | league | ⚠️ | ❌approx | as above | same (odds-thin) |
| CL | 2 | CL | ✅ | ✅ | ⚠️ | ✅ | counts | ✅ | league | ⚠️ | ❌approx | as above | same |
| EL | 3 | — | ❌ | ✅ | ⚠️ | ✅ | counts | ⚠️ | league | ⚠️ | ❌approx | **no fallback** | same (odds-thin) |
| ECL | 848 | — | ❌ | ✅ | ⚠️ | ✅ | counts | ⚠️ | league | ⚠️ | ❌approx | **no fallback** | same (odds-thin) |
| BL2 | 79 | — | ❌ | ✅ | ⚠️ | ✅ | counts | ⚠️ | league | ⚠️ | ❌approx | **no fallback** | same (odds-thin) |
| PD2 | 141 | — | ❌ | ✅ | ⚠️ | ✅ | counts | ⚠️ | league | ⚠️ | ❌approx | **no fallback** | same (odds-thin) |
| SA2 | 136 | — | ❌ | ✅ | ⚠️ | ✅ | counts | ⚠️ | league | ⚠️ | ❌approx | **no fallback** | same (odds-thin) |
| FL2 | 62 | — | ❌ | ✅ | ⚠️ | ✅ | counts | ⚠️ | league | ⚠️ | ❌approx | **no fallback** | same (odds-thin) |
| ELC | 40 | ELC | ✅ | ✅ | ⚠️ | ✅ | counts | ✅ | league | ⚠️ | ❌approx | as above | same |
| MLS | 253 | — | ❌ | ✅ | ⚠️ | ✅ | counts | ⚠️ | league | ⚠️ | ❌approx | **no fallback**; season = calendar year | same (odds-thin) |
| LIB | 262 | — | ❌ | ✅ | ⚠️ | ✅ | counts | ⚠️ | league | ⚠️ | ❌approx | **no fallback** | same (odds-thin) |
| J1 | 98 | — | ❌ | ✅ | ⚠️ | ✅ | counts | ⚠️ | league | ⚠️ | ❌approx | **no fallback** | same (odds-thin) |
| ARG | 128 | — | ❌ | ✅ | ⚠️ | ✅ | counts | ⚠️ | league | ⚠️ | ❌approx | **no fallback**; split-season year risk | same (odds-thin) |
| BRA | 71 | BSA | ✅ | ✅ | ⚠️ | ✅ | counts | ✅ | league | ⚠️ | ❌approx | as above | same |

**Leagues with incomplete *fallback* coverage (10):** EL, ECL, BL2, PD2, SA2, FL2, MLS, LIB, J1, ARG (VERIFIED: `lib/api/provider-mapping.json` — these entries carry no `footballDataCode`).

**Verdict per league:** because API-Football coverage is variant-uniform, *no league is individually better or worse on the primary provider except by bookmaker odds depth and season entitlement*. Every league shares the same structural gaps (⚠️ team-stat shape §6.1; never-populated motivation/schedule/referee/pace; approximated first-half; fabricated fallback odds). **The 10 fallback-less leagues are materially less resilient**: any API-Football outage or entitlement lapse for those leagues yields no output at all.

**Season-entitlement caveat (ESTIMATED, high impact):** on the **Free** plan API-Football serves only recent seasons (`API_FOOTBALL_FREE_TIER_SEASON_MIN/MAX_YEARS_AGO = 4/2`, `provider-mapping.ts:109-110`), so **current-season fixtures/statistics are generally not served on Free** — every league is effectively incomplete on Free regardless of the matrix above. This is the single largest league-coverage risk and is resolved only by a paid (Pro) entitlement.

---

## 6. Missing and weak prediction factors (Task 3)

Classification key: **Available** (provider supplies and adapter maps) · **Calculated** (derived internally from other fields) · **Approximated** (coarse derivation) · **Hardcoded** (constant) · **Neutral** (defaults to 50/fallback when absent) · **Not implemented** (never produced and never defaulted meaningfully).

| Factor | Status | Evidence |
|---|---|---|
| Team motivation | **Not implemented → Neutral** | Read in `shared.ts:65`, `asianHandicap.ts:47`, `firstHalfResult.ts:19`, `totalCards.ts:12`; **never written** (repo search). |
| Fixture importance | **Not implemented** | No field exists in `FixtureEnrichment` (`types/analysis.ts:94-110`). |
| League position / relegation / title pressure | **Not implemented** | No standings ingestion into enrichment (Football-Data `/standings` used only for goals/form, `football-data.ts:198-206`). |
| Recent fixture congestion | **Not implemented** | No `schedule` producer; `scheduleScore` neutral (`normalization.ts:88`). |
| Rest days | **Not implemented → Neutral** | `enrichment.schedule?.homeRestDays` always undefined. |
| Home/away performance split | **Not implemented** | `/teams/statistics` split not mapped; only aggregate `goalsFor/Against`. |
| Team form | **Available** | `parseForm` (`football-api.ts:200`, `football-data.ts:193`); used in `formContrast` (`shared.ts:79`). |
| Head-to-head | **Available** (primary) | `fetchH2H` (`football-api.ts:214`); `h2h.bttsRate`/`over25Rate` computed (`:254-262`). |
| Injuries | **Partial → key factor inert** | `fetchInjuries` returns counts but `keyHome/keyAway = 0` (`football-api.ts:277`). |
| Suspensions | **Not implemented** | `/injuries` used; the suspensions endpoint is not called; no `suspensions` field. |
| Expected goals (xG) | **Partial** | `xgFor` attempted (`football-api.ts:203`); `xgAgainst` never set. |
| Goals for/against | **Available** | `goalsFor`/`goalsAgainst` (`football-api.ts:204-205`). |
| Referee statistics | **Not implemented → Neutral** | Read (`totalCards.ts:16`, `asianHandicap.ts:51`); never written. |
| Match pace | **Not implemented → Neutral** | Read (`overUnder.ts:16`); never written. |
| Corners averages | **Partial** | `cornersFor` attempted (`football-api.ts:206`); `cornersAgainst` never set; `leagueAvgCorners` never set. |
| Cards averages | **Partial** | `cardsFor` attempted (`football-api.ts:207`); `cardsAgainst` never set; `leagueAvgCards` never set. |
| First-half statistics | **Approximated** | `firstHalfGoalsFor/Against` never set ⇒ `xgFor·0.45` (`firstHalfResult.ts:10`). |
| League averages | **Partial** | `leagueAvgGoals` only via fallback (`football-data.ts:162`); corners/cards averages never set. |
| Weather | **Available** | Open-Meteo (`ingestion/weather.ts`); key `weather:{lat}:{lon}` (3-dp). |

### 6.1 Critical unverified mapping risk — `/teams/statistics`

**NOT VERIFIED (high impact).** `normalizeTeamStats` (`lib/api/football-api.ts:190-212`) reads `payload.statistics` as an **array of `{type, value}`** and matches fields by substring (`'expected goals'`, `'goals:for'`, `'corners'`, …). The documented API-Football v3 `/teams/statistics` payload is a **nested object** (`goals.for.total`, `cards`, `fixtures`, …), not a `statistics[]` array. If the live schema is the documented one, `entries` is empty, **every `find()` returns `undefined`, and team stats degrade to `{form: undefined}`** — silently neutralising `MATCH_RESULT`, `BTTS`, `OVER_UNDER`, `TOTAL_CORNERS`, `TOTAL_CARDS`, and weakening the Poisson model to league averages.

This is **not covered by any test** (VERIFIED: `tests/analysis-engine.test.ts` and `tests/analysis-utils.test.ts` construct `TeamStats` objects directly; `analysis-adapters.test.ts` exercises fixtures only). **Action required before production:** capture one real `/teams/statistics` response and confirm the mapped shape (this cannot be done under the read-only constraint). Treat as a **potential Phase 1 blocker** until disproven.

---

## 7. Confidence calculation assessment (Task 5)

**Mechanism (VERIFIED).** `confidenceFromDirection(direction, evidence) = normalize(50 + |direction−50| · clamp(evidence,0,1))` (`lib/analysis/utils/confidence.ts:50`). `evidence = evidenceScore(values) = presentCount / totalInputs` (`:44`). `direction = weightedScore(factors)` over the market's configured weights only (`shared.ts:12` — `buildFactors` iterates **weight keys**, so extra keys in a scorer's `scores` object are ignored).

**Is confidence genuinely evidence-derived?** Largely yes: the evidence multiplier shrinks the score toward 50 as inputs go missing. **CALCULATED:** to reach the 75 threshold via direction alone you need `|direction−50| ≥ 25/evidence`; at full evidence that is `direction ≥ 75`, at half evidence `direction ≥ 100` (unreachable). **Missing data therefore *lowers* confidence in most markets — this is the correct direction.**

**Can missing inputs artificially inflate confidence?** Partially, in three specific ways (VERIFIED/CALCULATED):

1. **Sentinel zeros count as evidence.** `evidenceScore` accepts any finite number, so `injuries.home = 0` / `injuries.away = 0` (returned by `fetchInjuries` for an empty list, `football-api.ts:277`) and the `h2h` stub `{matches:0,…}` (`football-api.ts:218`) register as *present* evidence. This raises the evidence multiplier above the true richness of the data and can lift a moderate direction toward 75.
2. **Permanently-neutral factors dilute direction but not the denominator.** Markets whose inputs are never populated (`motivation`, `schedule`, `referee`, `pace`) reduce `|direction−50|` (conservative) yet still count in the evidence denominator only when the *input field* is present.
3. **Single-sided inputs can produce full-strength directions.** In `OVER_UNDER`, `recentTotals = (valueOr(homeXg,0) + valueOr(awayXg,0)) || undefined` (`overUnder.ts:11`): if only one side's xG exists, the sum is one-sided yet is scored as if it were a two-team total — a directional artefact, not a missing-data *deflation*.

**Is the 75 threshold meaningful?** It is an honest gate on a **heuristic model score** (correctly labelled "Model score", `confidence.ts:3-12`, `types/analysis.ts:122-128`), **not a calibrated probability**. It is *conservative* (hard to reach), which is a safety property. But it is **not comparable across markets**: markets with few required inputs (e.g. `DOUBLE_CHANCE`, 5 inputs) reach high evidence more easily than markets with many (`MATCH_RESULT`, 9 inputs, two of which—`motivation`—are never populated, capping its evidence).

**Cross-league consistency.** Identical rules apply to all 20 leagues (VERIFIED: no per-league branch in `engine.ts`; `LeagueConfig.marketWeights` unread). This is *consistent* but **not correctly calibrated**: thin-odds leagues simply yield more neutral factors, so their picks cluster closer to 50 and rarely clear 75 — a de-facto market/league restriction achieved by accident, not by design.

**Can the engine output high confidence with critical data missing?** **CALCULATED, conditional.** With every populated factor near-ceiling, `MATCH_RESULT` can approach ~80 despite `motivation` (w=0.1) being permanently neutral; `DOUBLE_CHANCE` can reach ~75 from the Poisson probability alone when evidence reaches 1.0 (which the injuries-zero sentinels can supply). So **yes, high-confidence outputs are achievable while material factors (motivation, schedule, referee, pace) are entirely absent** — provided the populated inputs (attack/h2h/form) are strong.

**Markets that should be gated when required inputs are absent (recommendation, not implemented):**
- `TOTAL_CARDS` — block unless `referee.cardsPerGame` is present (its dominant weight is otherwise neutral).
- `FIRST_HALF_RESULT` — block or down-rate while `firstHalfGoalsFor` is only approximated.
- `PLAYER_SCORER` — block unless the odds feed supplies a real player price (otherwise the fabricated 1.91 is persisted).
- `ASIAN_HANDICAP` — already self-gating ✅; `CORRECT_SCORE` — already self-gating ✅.

> The passing test `tests/analysis-engine.test.ts:124 ("generates a high-confidence pick")` **must not be cited as evidence that real provider data clears 75**, because its `strongEnrichment` (lines 28-81) hand-populates exactly the fields the adapters cannot produce.

---

## 8. Data quality and freshness findings (Task 6)

| # | Finding | Evidence | Label |
|---|---|---|---|
| 1 | **No provider payload schema validation** — adapters use loose field reads + `toNumber`/`parseForm` coercion; unknown/missing shapes silently yield `undefined`. | `normalizeTeamStats` (`football-api.ts:190`), `normalizeFixture` (`:123`), `teamStatsFromTable` (`football-data.ts:198`). | VERIFIED |
| 2 | **`/teams/statistics` shape mismatch risk** (see §6.1) — may silently empty all team stats. | `football-api.ts:192-199`. | NOT VERIFIED |
| 3 | **Postponed/cancelled/abandoned/suspended fixtures are not filtered.** `normalizeFixture` reads no fixture **status**; every fixture returned by the provider inside the 48 h window is analysed. | `football-api.ts:123-142` (no `fixture.status`), `football-data.ts:114-131` (no `status`). | VERIFIED |
| 4 | **Stale odds are not detectable.** Odds are cached 24 h (`cache.ts:5`) with no timestamp/as-of field on `OddsRecord` (`types/analysis.ts:65-76`); a stale or pre-lineup price is indistinguishable from a fresh one. | `fetchOdds` (`football-api.ts:310`), `cachedProviderFetch` (`cache.ts:7`). | VERIFIED |
| 5 | **Stale injuries likewise undated**; injury counts cached 24 h with no snapshot time. | `fetchInjuries` (`football-api.ts:265`). | VERIFIED |
| 6 | **Cache TTL equals the cron interval** (24 h cache vs `0 6 * * *` daily run) ⇒ every run is a cold run and the cache primarily serves intra-run retries, not cross-run reuse. | `cache.ts:5`, `vercel.json:12-14`. | CALCULATED |
| 7 | **Season derived by calendar year** — `season = fixture.kickoff.getUTCFullYear()` (`football-api.ts:145`), which mislabels split-season competitions (e.g. a Jan–Jun 2026 fixture belongs to the 2025/26 season but requests season `2026`) ⇒ empty/wrong team stats and scorers. | `football-api.ts:145`, `:179-188`, `:366-372`. | VERIFIED (code) / ESTIMATED (impact) |
| 8 | **Timezone handling** — kickoffs parsed from provider ISO strings into `Date`; run day computed in UTC (`run.ts:41-42`, `dateOnly` `fixtures.ts:10`). Provider date windows are passed as `YYYY-MM-DD` (API-Football) / `…T00:00:00Z` (Football-Data). No explicit stadium-local date handling. | `fixtures.ts:14-19`, `football-data.ts:92-93`. | VERIFIED |
| 9 | **Duplicate fixtures across providers are not cross-deduplicated** — `dedupeFixtures` keys `${source}:${id}` (`fixtures.ts:67-75`), so the same real match ingested from two providers would not be recognised as one. In practice only one provider runs per run, so impact is limited. | `fixtures.ts:67`. | VERIFIED |
| 10 | **Fallback can silently replace primary data** — for enrichment, `enrichFixtures` falls through providers on any thrown error (`enrichment.ts:33-43`); the degraded payload is not marked as "fallback" on `FixtureEnrichment` (only an `errors[]` entry), so downstream/review cannot tell a full enrichment from a minimal one. | `enrichment.ts:25-57`. | VERIFIED |
| 11 | **Fabricated odds persisted** — `oddsOrDefault` returns `1.91` when the real price is absent (`shared.ts:34`); this value becomes `bestOdds` (`persistence.ts:86`) and can be published. | `shared.ts:34`, `persistence.ts:86`. | VERIFIED |
| 12 | **Null/undefined handled defensively in scoring** — every scorer uses `?? 50` / `valueOr(…, fallback)` / `goalRateScore(undefined,…)=50`, so nulls cannot throw. | `shared.ts:38-44`, `normalization.ts:4-7`. | VERIFIED |

---

## 9. Provider fallback assessment (Task 7)

**When is fallback triggered? (VERIFIED)** Two independent layers, both driven by **thrown errors only**:
- Fixture discovery: `fixtures.ts:39-57` iterates `dataSourcePriorities`; a provider is abandoned only when it **throws**. `ProviderQuotaExhaustedError`/`ProviderAuthError` are **re-thrown** (no fallback) — correct: an exhausted provider cannot be substituted silently.
- Enrichment: `enrichment.ts:33-43` tries providers in order; a provider is abandoned only when `loadEnrichment` **throws**. Per-endpoint failures inside the API-Football adapter are swallowed by `safe()` into `errors[]` and return `undefined` — they **do not** trigger the Football-Data fallback.

**Missing critical fields do NOT trigger fallback.** If `/teams/statistics` fails, the adapter records an error and continues with `homeStats: undefined`; the engine then uses neutral defaults. Football-Data is never consulted for that field. (VERIFIED.)

**Can Football-Data.org substitute per market?** Largely **no** (VERIFIED against `football-data.ts:133-206`):

| Required input | Football-Data supplies? |
|---|---|
| Fixtures | ✅ `/competitions/{code}/matches` |
| Attack / goals for | ✅ (from `/standings`) |
| Defence / goals against | ✅ (from `/standings`) |
| Form | ✅ |
| **xG** | ❌ |
| **H2H** | ❌ |
| **Injuries** | ❌ |
| **Odds** | ❌ |
| **Corners / cards** | ❌ |
| **First-half** | ❌ |
| **Referee / pace / motivation / schedule** | ❌ |
| League average goals | ✅ (computed, `football-data.ts:162`) |

**Consequences:** under fallback, `BTTS`, `MATCH_RESULT` and `OVER_UNDER` degrade to goals/form/league-average only; `ASIAN_HANDICAP` always declines (no odds); `TOTAL_CORNERS`/`TOTAL_CARDS`/`FIRST_HALF`/`PLAYER_SCORER` are effectively unsupported; and the fabricated `1.91` odds path is exercised for every non-declining market. **Football-Data.org is a fixture/standings safety net, not a per-market equivalent.**

**Coverage gap:** 10 of 20 leagues have **no** Football-Data fallback (§5).

---

## 10. Critical production risks

Ordered by severity.

1. **P0 — `/teams/statistics` shape risk (§6.1, NOT VERIFIED).** If the live schema differs from the adapter's `statistics[]` assumption, *all* team-stat-driven markets silently collapse to league averages while still producing picks.
2. **P0 — Free-plan season entitlement (ESTIMATED).** Current-season data is generally not served on Free (`provider-mapping.ts:109-115`) ⇒ fixtures/stats/scorers are absent or wrong for every league; the 20-league coverage claim is unattainable on Free.
3. **P1 — Fabricated `1.91` odds published as `bestOdds` (§8.11).** Users may see a non-existent price; especially pervasive for corners/cards/correct-score/first-half/player markets.
4. **P1 — Weak markets published:** `TOTAL_CARDS` (dominant factor always neutral), `FIRST_HALF_RESULT` (approximated), `PLAYER_SCORER` (league-wide scorers + fabricated odds).
5. **P1 — Season-by-calendar-year bug (§8.7)** yields empty stats/scorers for split-season fixtures in the Jan–Jun window.
6. **P1 — No match-status filter (§8.3):** postponed/abandoned fixtures can be analysed and published.
7. **P2 — Silent fallback labelled only in `errors[]` (§8.10):** reviewers cannot easily distinguish full vs minimal enrichment.
8. **P2 — Stale odds/injuries undetectable (§8.4/8.5).**
9. **P2 — Confidence not comparable across markets (§7):** two markets at "75" are not equally supported.
10. **P2 — `LeagueConfig.marketWeights` stored but unread (§3):** per-league weighting appears configurable but is inert.

---

## 11. Recommended remediation priorities

*(Recommendations only — no fixes were implemented under this read-only audit.)*

**Phase 1 blockers (must resolve before first real production run):**
1. Capture and compare one live `/teams/statistics` and `/fixtures` response against `normalizeTeamStats`/`normalizeFixture`; correct the mapping and add a captured-fixture regression test.
2. Confirm the production API-Football entitlement serves **current-season** data for all 20 leagues (Pro). If not, restrict the enabled-league set.
3. Fix season derivation to use competition season semantics, not `getUTCFullYear()`.
4. Stop persisting fabricated odds: either block markets without a real captured price, or persist `null`/omit the pick (no `1.91`).
5. Gate/disable `TOTAL_CARDS`, `FIRST_HALF_RESULT`, `PLAYER_SCORER` for Phase 1 (or require their header inputs).
6. Filter fixtures by provider **status** (exclude postponed/cancelled/abandoned/suspended).
7. Mark fallback-degraded enrichments explicitly so review cannot mistake them for full data.

**Phase 2 improvements:**
- Populate `motivation`/`schedule`/`referee`/`pace` (e.g. standings-driven motivation, fixtures-list congestion, referee endpoint, possession/tempo proxies) or remove them from weight configs so weights reflect available evidence.
- Populate per-team `xgAgainst`, `cornersAgainst`, `cardsAgainst`, `firstHalf*` from the provider.
- Store `as-of` timestamps for odds/injuries and reject stale values.
- Read `LeagueConfig.marketWeights` per league (or remove the column).
- Evidence model: exclude sentinel/stub values from `evidenceScore`; add per-market minimum-input gates.
- Reconcile cache TTL with cron cadence (or accept cold-runs explicitly).
- Backtest/calibrate model scores against historical outcomes before any accuracy claim.

---

## 12. Phase 1 blockers vs Phase 2 improvements

**Phase 1 blockers (data correctness — do not ship without):** §11 items 1–7. These are correctness/safety defects: wrong-shape team stats, wrong season, fabricated odds, unsupported markets published, unfiltered match status, entitlement.

**Phase 2 improvements (enrichment/quality — ship with explicit limitations):** §11 Phase 2 items. These raise fidelity (more factors, freshness, per-league tuning) but the Phase 1 pipeline is safe to operate *without* them **provided** the affected markets are gated and limitations are documented in the review UI.

---

## Final requirement — direct answers

**1. Can PredictPro safely generate all 10 markets today?**
**No.** Six markets (Match Result, Double Chance, Correct Score, Over/Under 2.5, Asian Handicap, BTTS) are *conditionally* safe — conditional on the `/teams/statistics` shape being confirmed and on real odds or an explicit decline. Four markets (Total Corners, Total Cards, First-Half Result, Player Scorer) are **not** safe: they run on permanently-neutral or approximated factors, and two of them persist fabricated `1.91` odds.

**2. Which markets have sufficient data?**
- **Sufficient (with limitations):** `MATCH_RESULT`, `DOUBLE_CHANCE`, `CORRECT_SCORE` (which carries the league-source evidence guard), `OVER_UNDER_2_5`, `BTTS`.
- **Self-gating / safe by design:** `ASIAN_HANDICAP` (declines to "No handicap" without a captured line).

**3. Which markets lack critical data?**
- `TOTAL_CARDS` — dominant factor `referee` (w=0.35) never populated; `leagueAvgCards`, `stakes` also absent.
- `FIRST_HALF_RESULT` — `firstHalfGoalsFor` never populated (approximated as `xgFor·0.45`); h2h first-half never populated.
- `PLAYER_SCORER` — candidate pool is the league's season top scorers, not fixture participants; `odds.playerScorer` never populated ⇒ always fabricated price.
- `TOTAL_CORNERS` — `leagueAvgCorners` never populated; depends on the unverified `/teams/statistics` shape.

**4. Which of the 20 leagues have incomplete coverage?**
Every league shares the same *primary-provider* structural gaps (never-populated motivation/schedule/referee/pace; approximated first-half; no real odds for corners/cards/score/first-half/player). Additionally, **10 leagues have no Football-Data fallback**: **EL, ECL, BL2, PD2, SA2, FL2, MLS, LIB, J1, ARG**. On the Free entitlement, **all 20** are incomplete for the current season.

**5. Can missing data produce misleading confidence scores?**
**Partially, yes — but the overall direction is conservative.** Missing inputs normally *lower* confidence because of the evidence multiplier. However: (a) sentinel zeros (`injuries=0`) and the `h2h {matches:0}` stub count as *present* evidence and can inflate the multiplier; (b) single-sided inputs (e.g. one team's xG in Over/Under) can produce a full-strength direction; and (c) markets with fewer required inputs reach high confidence more easily, so a "75" is **not comparable across markets**. No calibration/backtest exists, so confidence must never be presented as a win probability.

**6. What is the minimum work to make Phase 1 production-ready?**
The seven **Phase 1 blockers** in §11: (1) confirm/correct the `/teams/statistics` (and fixture) mapping with a captured-fixture test; (2) confirm/restrict current-season entitlement for 20 leagues; (3) fix season derivation; (4) stop persisting fabricated odds; (5) gate or disable Total Cards, First-Half, Player Scorer; (6) filter fixtures by match status; (7) label fallback-degraded enrichments.

**7. Can we proceed with API-Football Pro as the primary provider, retaining Football-Data.org as a limited fallback?**
**Yes — with scope discipline.** API-Football Pro is the only provider that can address all 20 leagues and supply team stats, H2H, injuries, odds and scorers. Football-Data.org **cannot** be a per-market equivalent (no H2H/injuries/odds/xG/corners/cards/first-half) and covers only 10/20 leagues, so it must be treated strictly as a **fixtures/standings safety net** for those 10 leagues, with markets re-gated when it is active. The `/teams/statistics` shape must be verified first (P0).

**8. What must be fixed before the first real production prediction run?**
Exactly the **Phase 1 blockers (§11, items 1–7)**, in priority order: verify the team-statistics/fixture mapping against real payloads → confirm Pro entitlement serves current-season data → fix season derivation → eliminate fabricated odds → gate the weak markets → exclude non-played fixture statuses → expose fallback-degraded enrichments to review. Until these are done, publishing `TOTAL_CARDS`, `FIRST_HALF_RESULT` and `PLAYER_SCORER` predictions — and any pick whose odds are the fabricated `1.91` — should be disabled.

---

### Verdict

**CONDITIONALLY READY.** The orchestration, persistence, review and publishing layers are production-grade and the confidence model is honestly labelled and conservative. But the data layer does not yet supply enough verified, correctly-mapped inputs for all ten markets. Phase 1 becomes **READY** once the seven blockers above are resolved and the four weak markets are gated; until then the correct posture is **NOT READY for Total Cards / First-Half Result / Player Scorer**, and **READY-with-limitations** for the six main markets, contingent on the `/teams/statistics` mapping being confirmed against a live payload.

*This document is an audit only. No application code, configuration, database, migration, dependency or deployment setting was modified, and no live prediction run was executed.*
