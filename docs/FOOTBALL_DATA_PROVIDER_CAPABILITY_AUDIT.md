# PredictPro — Football-Data.org Provider Capability Audit (Read-Only)

- **Audit type:** Independent, evidence-based provider capability audit
- **Date:** 2026-11-22
- **Repository:** `Kelly883/Prediction-claude-` — branch `trae/agent-4phDPY`, HEAD `ecb58fe`
- **Scope:** The existing Football-Data.org **v4** integration only
- **Modification during audit:** **None.** No code, config, dependencies, database records or production services were changed. No commit/push. No live provider request was made. This report (`docs/FOOTBALL_DATA_PROVIDER_CAPABILITY_AUDIT.md`) is the only file created.

> **Evidence legend:** **[VERIFIED]** read from source or official docs · **[CALCULATED]** derived from the code · **[ESTIMATED]** assumption-based · **[NOT VERIFIED]** needs live/subscription confirmation.

---

## 1. Executive summary

- The integration is a **thin fallback** of exactly **three** endpoints, all in `lib/api/football-data.ts`: `GET /competitions/{code}/matches`, `GET /competitions/{code}/standings`, `GET /competitions/{code}/scorers`. **[VERIFIED]**
- Only **10 of the 20** internal competitions have a Football-Data.org code. The other 10 (`EL, ECL, BL2, PD2, SA2, FL2, MLS, LIB, J1, ARG`) carry no code and are **skipped**, not requested. **[VERIFIED]**
- Football-Data.org v4 **cannot supply injuries or odds** — neither resource exists in the API. These are the two data types the 10-market engine depends on most for pricing and for the Asian-Handicap line. **[VERIFIED against official docs]**
- Football-Data.org **can** retrieve fixtures across multiple competitions in a **single** request (`GET /v4/matches?competitions=…`), but the adapter **does not use it** — it calls one competition at a time. **[VERIFIED against official docs]**
- Football-Data.org **does** expose head-to-head (`GET /v4/matches/{id}/head2head`), but the adapter **does not implement it**. **[VERIFIED against official docs]**
- Because the fallback is **first-success-wins per fixture**, Football-Data.org **cannot overwrite** better/fresher API-Football data. The real risk is the opposite: a *hollow* (non-throwing) API-Football enrichment suppresses the fallback entirely. **[VERIFIED]**
- **Answers:** FD **cannot** reduce API-Football consumption *with the current code*; it **cannot safely serve as a fallback for all 20 competitions** (10 only, and without injuries/odds); it **cannot replace** API-Football for any complete part of Phase 1.

**Verdict: Football-Data.org is a legitimate partial fallback for 10 competitions' fixtures/standings/scorers, but it is structurally incapable of replacing API-Football and should not be relied on to cut API-Football consumption without significant new work.**

---

## 2. Endpoints currently integrated (item 1)

All calls originate from `lib/api/football-data.ts`; the internal `request()` helper (L27–67) is the only HTTP call site (base `https://api.football-data.org/v4`). **[VERIFIED]**

| # | Endpoint | Function | Data | Granularity | Cache key / TTL |
|---|---|---|---|---|---|
| 1 | `GET /competitions/{code}/matches?dateFrom&dateTo` | `fetchFootballDataFixtures` (L77–112, call L91) | Fixtures in window | **Per competition** (1 call per supported league) | `football-data:fixtures:{code}:{from}:{to}` / 24 h |
| 2 | `GET /competitions/{code}/standings` | `fetchStandings` (L178–196, call L182) | League table | **Per competition, per fixture** (deduped by cache across the league) | `football-data:standings:{competition}` / 24 h |
| 3 | `GET /competitions/{code}/scorers?limit=5` | `fetchScorers` (L208–222, call L212) | Top 5 scorers | **Per competition, per fixture** (deduped) | `football-data:scorers:{competition}` / 24 h |

Note: endpoints 2 and 3 are invoked from `fetchFootballDataEnrichment` (L147–150) **once per fixture**, relying on the cache to collapse them to one call per competition.

---

## 3. The 20 competitions and their Football-Data.org codes (item 2)

Source: `lib/api/provider-mapping.json` + `provider-mapping.ts`. **[VERIFIED]**

| Internal | API-Football id | Football-Data code | In FD Free tier? |
|---|---|---|---|
| PL | 39 | `PL` | Yes |
| PD | 140 | `PD` | Yes |
| BL1 | 78 | `BL1` | Yes |
| SA | 135 | `SA` | Yes |
| FL1 | 61 | `FL1` | Yes |
| PPL | 94 | `PPL` | Yes |
| ERE | 88 | `DED` *(renamed)* | Yes |
| CL | 2 | `CL` | Yes |
| ELC | 40 | `ELC` | Yes |
| BRA | 71 | `BSA` *(renamed)* | Yes |
| **EL** | 3 | — | **No mapping** |
| **ECL** | 848 | — | **No mapping** |
| **BL2** | 79 | — | **No mapping** |
| **PD2** | 141 | — | **No mapping** |
| **SA2** | 136 | — | **No mapping** |
| **FL2** | 62 | — | **No mapping** |
| **MLS** | 253 | — | **No mapping** |
| **LIB** | 262 | — | **No mapping** |
| **J1** | 98 | — | **No mapping** |
| **ARG** | 128 | — | **No mapping** |

**10 mapped, 10 unmapped.** `partitionByProviderSupport('football-data', codes)` returns the 10 mapped as `supported` and the other 10 as `unsupported`; unsupported codes are logged and skipped (`football-data.ts` L82–84). **[VERIFIED]**

---

## 4. Which competitions are accessible under the intended subscription (item 3)

Football-Data.org's entitlement is by **competition tier**, and the free ("Tier One") plan exposes **12 competitions** (per the official pricing/coverage pages, accessed 2026-11-22). Our 10 mapped codes fall inside the free set. **[VERIFIED for the free set]**

The other 10 internal competitions (EL, ECL, BL2, PD2, SA2, FL2, MLS, LIB, J1, ARG) **do appear in the provider's catalogue** (e.g. UEFA Europa League, UEFA Conference League, Serie B, Segunda, Ligue 2, 2. Bundesliga, MLS, Liga MX, J.League, Liga Profesional) — but under **higher (paid) tiers**. The exact per-competition tier assignment was **not exposed** by the fetched coverage page (check-box columns returned empty). **[NOT VERIFIED — requires the dashboard/coverage page to confirm the tier for each of the 10]**

> Distinction (per the brief): competition **exists** in the FD catalogue ≠ available on the free tier ≠ available on the specific paid tier purchased. Only the first two are established here.

---

## 5. Multi-competition fixtures in one request (item 4)

- **The adapter issues one request per competition** (`/competitions/{code}/matches`). **[VERIFIED]**
- **The API supports multi-competition retrieval in a single call:** `GET /v4/matches?competitions={id1,id2,…}&dateFrom=&dateTo=`. The official quickstart lists a "List matches across (a set of) competitions" resource with a `competitions` filter (comma-separated ids). **[VERIFIED against official docs]**
- Therefore, all supported competitions' fixtures *could* be fetched in **one** request instead of one-per-league — but the app does not do this. This is an **unused optimisation**, not a current behaviour.

---

## 6. Field coverage vs the 10 prediction markets (item 5)

Football-Data.org's match/standings/scorers payloads provide goals, form, played counts and scorer totals — but **no xG, no corners, no cards, no shots, no weather, no injuries, no odds**. The engine's per-market needs (see `lib/analysis/markets/*`) against FD availability: **[VERIFIED]**

| Market | Fields it needs | FD provides? |
|---|---|---|
| MATCH_RESULT | xG/goals, h2h, form, injuries | goals ✓, form ✓, h2h ✗(not fetched), injuries ✗ |
| BTTS | xG for/against, h2h.bttsRate, weather | goals ✓, xG ✗, h2h ✗, weather ✗ |
| OVER_UNDER_2_5 | leagueAvgGoals, team xG, h2h.over25Rate, weather | leagueAvgGoals ✓ (computed), goals ✓, h2h ✗, weather ✗ |
| ASIAN_HANDICAP | **odds line** (mandatory), injuries, schedule | **odds ✗ → market always declines** |
| DOUBLE_CHANCE | Poisson model, h2h, injuries | goals ✓, h2h ✗, injuries ✗ |
| CORRECT_SCORE | Poisson, goalsAgainst, h2h.over25Rate, weather | goals ✓, h2h ✗, weather ✗ |
| FIRST_HALF_RESULT | firstHalfGoalsFor / xG, h2h | ✗ (not in standings) |
| TOTAL_CORNERS | cornersFor, shotsFor, leagueAvgCorners | ✗ |
| TOTAL_CARDS | cardsFor, referee, leagueAvgCards | ✗ |
| PLAYER_SCORER | top scorers, opponent goalsAgainst | scorers ✓, goalsAgainst ✓, playerScorer odds ✗ |

**Conclusion:** FD can partially feed the **goals/form-driven** markets for its 10 competitions, but **cannot** feed injuries, odds, weather, xG, corners or cards. The corners/cards markets become effectively neutral and the Asian-Handicap market degenerates to `"No handicap"` (it needs a real captured line).

---

## 7. Head-to-head availability and retrieval (item 6)

- **Available:** `GET /v4/matches/{id}/head2head?limit={n}` — "List previous encounters for the teams of a match", supporting `limit`, `dateFrom`, `dateTo`, `competitions`. **[VERIFIED against official docs]**
- **Retrieval requires a match id** (it is a subresource of a concrete match).
- **The adapter does not call it.** `fetchFootballDataEnrichment` fetches only standings + scorers; no H2H request exists. So `enrichment.h2h` is **always undefined** on the FD path → all `h2h*` factors default to neutral. **[VERIFIED]**

---

## 8. Injuries, odds, lineups, detailed stats under the plan (item 7)

| Data | Football-Data.org v4 | Plan requirement |
|---|---|---|
| Injuries | **Not provided** (no such resource) | — |
| Odds | **Not in the core API**; only a separate **Odds Add-On (€15/mo, 40 competitions, pre-match 1X2 only)** | Paid add-on; still no BTTS/O-U/AH/CS/1H/corners/cards odds |
| Line-ups | **Not provided** as a resource | — |
| Detailed team stats | Standings give played/goals/form only; corners/cards/shots/etc. require the **Statistic Add-On (€15/mo)** | Paid add-on |

**[VERIFIED against official docs + official pricing page (2026-11-22)]** — the official resource list contains **no** injuries, odds, or lineups endpoints.

---

## 9. Does the adapter map FD responses correctly? (item 8)

| Area | Finding | Severity |
|---|---|---|
| Fixture normalisation (`normalizeFixture`, L114–131) | Maps id, competition name, `utcDate`, team names/ids, `source`. **Does not map venue coordinates** → `fetchWeather(undefined, undefined)` returns nothing, so **weather is never applied** on FD fixtures. | Medium |
| Fixture status | No status filter is applied; `POSTPONED`/`CANCELLED`/`SUSPENDED` matches can be ingested and analysed. | Medium |
| Date filter format | Adapter sends `dateFrom=…T00:00:00Z` / `dateTo=…T23:59:59Z` (ISO datetime); docs specify `yyyy-MM-dd`, and v4 documents **`dateTo` as exclusive**. Correctness **unverified**. | Low–Medium **[NOT VERIFIED]** |
| Standings → `TeamStats` (`teamStatsFromTable`, L198–206) | Maps `goalsFor`, `goalsAgainst`, `form` only. **No xG, corners, cards, shots, first-half goals** → many market factors default to neutral. Team matching is by id or exact name. | Medium |
| Scorers → `PlayerRecord` (L216–222) | Maps name, goals, `minutesPlayed`, penalties, position. Reasonable. | Low |
| `leagueAvgGoals` (L162) | Computed as `totalGoals / (totalPlayed/2)`. Reasonable approximation. | Low |
| Error handling | Quota/auth errors rethrown (fail loud); other errors collected in `errors[]`. Correct. | — |

---

## 10. API-Football ↔ Football-Data.org equivalence (items 9 & 10)

| API-Football endpoint | Football-Data.org equivalent | Equivalent exists? |
|---|---|---|
| `GET /fixtures` | `GET /competitions/{id}/matches` (or `/matches?competitions=`) | **Yes** |
| `GET /players/topscorers` | `GET /competitions/{id}/scorers` | **Yes** |
| `GET /teams/statistics` | `GET /competitions/{id}/standings` (partial) + Statistic Add-On | **Partial** |
| `GET /fixtures/headtohead` | `GET /matches/{id}/head2head` | **Yes** (but not implemented) |
| `GET /injuries` | **(none)** | **No — cannot be replaced** |
| `GET /odds` | **(none in core API)**; Odds Add-On = pre-match 1X2 only | **No — cannot be replaced** |

**Endpoints with NO Football-Data.org equivalent → cannot be replaced:** **`/injuries`** and **`/odds`** (the odds add-on is 1X2-only and would not cover BTTS, Over/Under, Asian Handicap line, Double Chance, Correct Score, First-Half, corners or cards).

---

## 11. Free vs paid limits and permissions (item 11)

Source: official pricing + coverage pages (accessed 2026-11-22). **[VERIFIED]** (per-competition tier assignment: **[NOT VERIFIED]**)

| Plan | Price /mo | Competitions | Rate limit |
|---|---|---|---|
| Free (Tier One) | €0 | 12 | 10 calls/min |
| Free w/ Livescores | €12 | 12 | 20 calls/min |
| ML Pack Light | €29 | 12 | 20 calls/min |
| Free + Deep Data | €29 | 12 | 30 calls/min |
| Standard | €49 | 30 | 60 calls/min |
| Advanced | €99 | 50 | 100 calls/min |
| Pro | €199 | 100 | 120 calls/min |
| Odds Add-On | +€15 | 40 | — (pre-match 1X2 only) |
| Statistic Add-On | +€15 | — | corners/cards/shots/etc. |

- **No documented daily quota** — FD's limit is **per-minute** (unlike API-Football's daily cap). Plan filter values are `TIER_ONE`…`TIER_FOUR`, matching the pricing tiers. **[VERIFIED]**
- Free tier = 12 competitions; our 10 mapped codes are within it.

---

## 12. Can the fallback overwrite better/fresher primary data? (item 12)

**No — with the current code it cannot.** Evidence:

- **Fixture level** (`fixtures.ts` L39–57): providers are tried in priority order and the function **returns the first provider that succeeds** (L49–50). It does **not** merge providers, so FD fixtures are only used if the entire API-Football fixture load throws. `dedupeFixtures` keys on `${source}:${id}` (L67–75). **[VERIFIED]**
- **Enrichment level** (`enrichment.ts` L29–43): per fixture, it loops `dataSourcePriorities` and **`break`s on the first provider that succeeds by assignment** (`enrichment = await loadEnrichment(...)`). It is a **full replacement**, not a field-level merge; FD is reached only when API-Football enrichment **throws**. **[VERIFIED]**

**The real, inverted risk:** `fetchApiFootballEnrichment` uses internal `safe()` wrappers, so a *partial* (hollow) API-Football result is returned **without throwing**. That counts as "success", the loop breaks, and **Football-Data.org never gets a chance to fill the gaps**. So the fallback cannot improve a degraded primary result — it can only rescue a total primary failure. **[VERIFIED]**

Also: weather is merged **additively** after provider selection (`enrichment.ts` L45–50), so it cannot overwrite provider data. And on the FD path weather is absent anyway (no coordinates).

---

## 13. Required comparison table (item 5 / deliverable)

| Data requirement | API-Football endpoint | Football-Data.org equivalent | Available? | Subscription restriction | Suitable for PredictPro? | Missing fields / limitations |
|---|---|---|---|---|---|---|
| Fixture discovery | `GET /fixtures` | `GET /competitions/{id}/matches` (or `/matches?competitions=`) | **Yes** | Comp must be in plan tier | **Yes** for the 10 mapped comps | 10/20 unmapped; no status filter; no venue coordinates |
| Team statistics | `GET /teams/statistics` | `GET /competitions/{id}/standings` | **Partial** | Corners/cards/shots need Statistic Add-On (€15) | **Partial** | No xG, corners, cards, shots, first-half goals from standings |
| Head-to-head | `GET /fixtures/headtohead` | `GET /matches/{id}/head2head` | **Yes (unused)** | Plan comp coverage | **Would be** if implemented | Not implemented; needs a match id |
| Injuries | `GET /injuries` | — | **No** | — | **No** | No injuries resource exists |
| Odds | `GET /odds` | — (Odds Add-On = 1X2 only) | **No** | Paid add-on; 1X2 only | **No** | No BTTS/O-U/AH/CS/1H/corners/cards; AH line unavailable → market declines |
| Top scorers | `GET /players/topscorers` | `GET /competitions/{id}/scorers` | **Yes** | Plan comp coverage | **Yes** | No per-player odds |
| Line-ups | `GET /fixtures` (lineups via other endpoint) | — | **No** | — | **No** | No lineups resource |
| Weather | *(external: Open-Meteo)* | — | n/a | — | **No on FD path** | FD fixtures carry no lat/long → weather factor unavailable |

---

## 14. Final answers

**Can Football-Data.org reduce API-Football request consumption?**
**Not with the current code.** The fallback is first-success-wins with API-Football first, so it runs **only when API-Football fails** — it never offloads a successful run. Reduction would require **routing specific leagues to Football-Data first** (per-league priority) and/or using the multi-competition `/matches` call — both are **code/config changes**, not current behaviour. Even then, offloading a league to FD would drop its injuries and odds, degrading several markets. **[VERIFIED/CALCULATED]**

**Can it safely serve as a fallback for all 20 competitions?**
**No.** Only **10 of 20** have an FD code; the other 10 are skipped. And even for those 10, FD supplies **no injuries and no odds**, and no xG/corners/cards/weather, so a fallback run would be materially weaker (AH always declines; corners/cards neutral). **[VERIFIED]**

**Can it replace API-Football for any part of Phase 1?**
**No complete part.** It can substitute for **fixture discovery, standings-derived goals/form, and top scorers** for the 10 mapped competitions, but it **cannot** replace injuries or odds for **any** competition — and those are required by the pricing and Asian-Handicap logic. So it cannot replace the primary provider for the workflow as a whole. **[VERIFIED]**

**What changes would be required before using it more extensively?** (documentation only — **not implemented**)
1. Add `footballDataCode` mappings for the other 10 competitions and **confirm their plan tier** (currently unverified).
2. Implement **H2H** via `GET /matches/{id}/head2head`.
3. Add **status filtering** (exclude POSTPONED/CANCELLED) and, if possible, **venue coordinates** (otherwise weather stays unavailable).
4. Enrich the FD→`TeamStats` mapping; subscribe to the **Statistic Add-On** for corners/cards/shots (xG has no FD source at all).
5. Subscribe to the **Odds Add-On** for 1X2 — noting it still would **not** cover the odds types the 10 markets need.
6. Resolve **date format / `dateTo` exclusivity** against the live API.
7. Introduce **per-league provider routing** (config) if the objective is to offload API-Football — and accept that offloaded leagues lose injuries/odds.
8. Model the **degraded markets** explicitly so a degraded FD analysis is never presented as equivalent to an API-Football analysis.

---

## 15. Sources and verification limits

**Official sources (accessed 2026-11-22):**
- Football-Data.org quickstart / resource list — `https://www.football-data.org/documentation/quickstart` (multi-competition `/matches`, `/matches/{id}/head2head`, absence of injuries/odds/lineups).
- Football-Data.org v4 reference — `https://docs.football-data.org/general/v4/index.html` (v4 design, `dateTo` exclusivity, `TIER_ONE…TIER_FOUR`).
- Football-Data.org pricing — `https://www.football-data.org/pricing` (plan prices, competition counts, per-minute limits, add-ons).
- Football-Data.org coverage — `https://www.football-data.org/coverage` (Free-tier competition list).

**Repository sources:** `lib/api/football-data.ts`, `lib/api/provider-mapping.json`, `lib/api/provider-mapping.ts`, `lib/analysis/ingestion/fixtures.ts`, `lib/analysis/ingestion/enrichment.ts`, `lib/analysis/engine.ts`, `lib/analysis/markets/*`.

**Explicitly not verified here:** the exact per-competition **plan tier** for the 10 unmapped competitions; whether the Odds/Statistic Add-Ons cover our specific competitions; live behaviour of the date filters; and any live entitlement (no credentials used).
