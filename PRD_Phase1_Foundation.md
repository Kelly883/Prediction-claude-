# PRD: Superadmin Daily Match Analysis Engine — Phase 1 Foundation Only

**Version:** 1.0  
**Date:** 2026-11-21  
**Status:** ✅ Approved — Ready for Execution  
**Scope:** Foundation Phase Only (Weeks 1-2)

---

## 1. Phase 1 North Star

Build the **data foundation and automated ingestion pipeline** for daily soccer match analysis — enabling a superadmin to review ≥75% confidence picks across 20 leagues via a secure dashboard, with manual booking code entry.

**Measurable Outcome:** Daily cron runs at 06:00 UTC, ingests fixtures from 20 leagues via free APIs, scores 10 markets per fixture, stores results, and surfaces picks ≥75% confidence — all with audit trail.

---

## 2. Decisions Locked (All 7 + League List)

| # | Decision | Value |
|---|----------|-------|
| 1 | Data Provider | Football-Data.org + API-Football (free tiers) |
| 2 | Leagues | **20 standard API-Football codes**: PL, PD, BL1, SA, FL1, PPL, ERE, CL, EL, ECL, BL2, PD2, SA2, FL2, ELC, MLS, LIB, J1, ARG, BRA |
| 3 | Threshold | 75% |
| 4 | Run Time | 06:00 UTC |
| 5 | Booking Code | Manual entry v1 (auto deferred to v2) |
| 6 | Notifications | Email + in-app |
| 7 | Backtest Period | 365 days |

---

## 3. Phase 1 Scope (In/Out)

### ✅ IN — Phase 1 Deliverables
| Item | Description |
|------|-------------|
| **Prisma Models** | `AnalysisRun`, `AnalysisResult`, `AnalysisConfig`, `LeagueConfig` + migrations |
| **League Seed** | 20 leagues with codes, enabled=true, priority=1 |
| **Config Seed** | Default market weights, global threshold=75, data source priorities |
| **Ingestion API** | `/api/cron/daily-analysis` (CRON_SECRET protected) |
| **Fixture Fetch** | Next 48h fixtures from 20 leagues via API-Football/Football-Data.org |
| **Enrichment** | Team stats, H2H, injuries, odds, weather (graceful degradation) |
| **Analysis Engine** | 10-market deterministic weighted scoring (core logic only) |
| **Threshold Filter** | Keep only market predictions ≥75% confidence |
| **Storage** | AnalysisRun + AnalysisResult records |
| **Superadmin API** | CRUD for runs, results, config (authz: superadmin only) |
| **Publish API** | Create PredictionPost from approved pick + manual booking code |
| **Authz** | Superadmin-only access to `/superadmin/analysis/*` |
| **Audit Log** | All config changes, approve/dismiss actions |
| **Tests** | Unit tests for engine, integration tests for API |
| **Lint/Typecheck/Build** | All passing |

### ❌ OUT — Deferred to Phase 2+
- Superadmin dashboard UI (React components)
- Pick detail drawer with factor breakdown
- Backtest API/UI
- Email notification templates
- Settings panel (weights, thresholds, leagues editor)
- Responsive design
- Accessibility audit
- Performance optimization

---

## 4. Data Models (Phase 1)

```prisma
model AnalysisRun {
  id              String   @id @default(uuid())
  runDate         DateTime @db.Date
  status          AnalysisRunStatus @default(pending)
  fixturesAnalyzed Int     @default(0)
  picksGenerated  Int     @default(0)
  startedAt       DateTime?
  completedAt     DateTime?
  errorMessage    String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  results         AnalysisResult[]
  @@index([runDate, status])
}

enum AnalysisRunStatus { pending running completed failed }

model AnalysisResult {
  id                String   @id @default(uuid())
  runId             String
  run               AnalysisRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  fixtureId         String
  homeTeam          String
  awayTeam          String
  league            String
  kickoff           DateTime
  bestMarket        MarketType
  bestSelection     String
  bestOdds          Decimal  @db.Decimal(6, 2)
  confidence        Decimal  @db.Decimal(5, 2)
  marketScores      Json
  topFactors        Json
  status            ResultStatus @default(pending)
  reviewedById      String?
  reviewedBy        User?    @relation(fields: [reviewedById], references: [id])
  reviewedAt        DateTime?
  dismissalReason   String?
  predictionPostId  String?
  predictionPost    PredictionPost? @relation(fields: [predictionPostId], references: [id])
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  @@index([runId])
  @@index([confidence])
  @@index([status])
}

enum MarketType {
  MATCH_RESULT BTTS OVER_UNDER_2_5 ASIAN_HANDICAP DOUBLE_CHANCE
  CORRECT_SCORE FIRST_HALF_RESULT TOTAL_CORNERS TOTAL_CARDS PLAYER_SCORER
}

enum ResultStatus { pending approved dismissed published }

model AnalysisConfig {
  id          String   @id @default(uuid())
  key         String   @unique
  value       Json
  description String?
  updatedById String
  updatedBy   User     @relation(fields: [updatedById], references: [id])
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model LeagueConfig {
  id          String   @id @default(uuid())
  leagueName  String   @unique
  leagueCode  String   @unique
  isEnabled   Boolean  @default(true)
  priority    Int      @default(1)
  marketWeights Json?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

---

## 5. API Contracts (Phase 1)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/cron/daily-analysis` | CRON_SECRET | Trigger daily run (Vercel Cron) |
| `GET` | `/api/superadmin/analysis/runs` | Superadmin | List runs (paginated) |
| `GET` | `/api/superadmin/analysis/runs/:id` | Superadmin | Run details + results |
| `POST` | `/api/superadmin/analysis/runs/:id/rerun` | Superadmin | Manual re-run |
| `GET` | `/api/superadmin/analysis/results` | Superadmin | Filter results (date, league, confidence, status) |
| `PATCH` | `/api/superadmin/analysis/results/:id` | Superadmin | Update status (approve/dismiss) + notes |
| `POST` | `/api/superadmin/analysis/results/:id/publish` | Superadmin | Create PredictionPost (requires bookingCode) |
| `GET` | `/api/superadmin/analysis/config` | Superadmin | Get config |
| `PATCH` | `/api/superadmin/analysis/config` | Superadmin | Update config |

---

## 6. Analysis Engine — 10 Market Specs (Phase 1 Core)

Each market: `confidence = Σ(weight × factor_score)` normalized 0-100.

| Market | Key Factors (weights sum to 1.0) |
|--------|----------------------------------|
| **Match Result** | Home xG vs Away xG (0.25), H2H (0.20), Form (0.20), Home Adv (0.15), Injuries (0.10), Motivation (0.10) |
| **BTTS** | Both avg scored (0.30), Both avg conceded (0.25), H2H BTTS (0.20), Defense (0.15), Weather (0.10) |
| **O/U 2.5** | League avg goals (0.25), Team xG (0.30), Recent totals (0.20), Pace (0.15), Weather (0.10) |
| **Asian Handicap** | Strength diff (0.30), Motivation (0.20), Schedule (0.15), H2H (0.15), Injuries (0.10), Referee (0.10) |
| **Double Chance** | Derived from Match Result probabilities |
| **Correct Score** | Poisson from xG (0.40), Defense (0.25), H2H scores (0.20), Weather (0.15) |
| **1H Result** | Early patterns (0.35), 1H xG (0.25), H2H 1H (0.20), Motivation (0.20) |
| **Total Corners** | Wing play (0.30), Set pieces (0.25), League avg (0.20), Style matchup (0.15), Weather (0.10) |
| **Total Cards** | Referee (0.35), Rivalry (0.25), Discipline (0.20), League avg (0.15), Stakes (0.05) |
| **Player Scorer** | Form (0.30), Position (0.20), Penalties (0.15), Opponent defense (0.20), Minutes (0.15) |

**Fixture Score:** `max(market_confidences)` — only fixtures with `score ≥ 75` become picks.

---

## 7. Ingestion Pipeline (Daily Run)

```
06:00:00  Create AnalysisRun (running)
06:00:05  Fetch fixtures (next 48h, 20 leagues, enabled only)
06:00:30  Parallel enrich (max 10 concurrent, 10s timeout each)
06:02:00  Run 10-market models per fixture
06:03:00  Filter ≥75%, store AnalysisResults
06:03:10  Update AnalysisRun (completed, counts)
06:03:15  Log completion (audit)
```

**Error Handling:** Partial fixture failure → log, continue. Total API failure → mark run failed.

---

## 8. Free API Integration Spec

| Provider | Endpoints Used | Rate Limits | Fallback |
|----------|----------------|-------------|----------|
| **API-Football** | Fixtures, Teams, H2H, Injuries, Odds | 100 req/day (free) | Cache 24h, last known |
| **Football-Data.org** | Fixtures, Standings, Scorers | 10 req/min | Cache 24h, last known |

**Implementation:** Adapter pattern — swap providers without engine changes.

---

## 9. Testing Requirements (Phase 1)

| Test Type | Coverage Target | Details |
|-----------|----------------|---------|
| **Unit** | 90% engine | Confidence calc per market, normalization, threshold filter, config validation |
| **Integration** | All API routes | Full daily run (mocked APIs), approve→publish, dismiss, config update |
| **Authz** | 100% | Superadmin allow, admin/user deny, unauthenticated deny |
| **Migration** | Idempotent | Up/down, seed replay |

---

## 10. File Map (Phase 1 Only)

```
/prisma/
  schema.prisma                          ← +4 models

/app/api/cron/
  daily-analysis/route.ts                ← Daily trigger (CRON_SECRET)

/app/api/superadmin/analysis/
  runs/route.ts                          ← GET, POST rerun
  runs/[id]/route.ts                     ← GET details
  results/route.ts                       ← GET filtered, PATCH status
  results/[id]/route.ts                  ← PATCH status
  results/[id]/publish/route.ts          ← Create PredictionPost
  config/route.ts                        ← GET, PATCH

/lib/analysis/
  engine.ts                              ← Core orchestration
  markets/
    matchResult.ts
    btts.ts
    overUnder.ts
    asianHandicap.ts
    doubleChance.ts
    correctScore.ts
    firstHalfResult.ts
    totalCorners.ts
    totalCards.ts
    playerScorer.ts
  ingestion/
    fixtures.ts                          ← Fetch from APIs
    enrichment.ts                        ← Stats, H2H, injuries, odds
  utils/
    confidence.ts                        ← Normalization, threshold
    normalization.ts

/lib/api/
  football-api.ts                        ← API-Football adapter
  football-data.ts                       ← Football-Data.org adapter

/types/
  analysis.ts                            ← TypeScript interfaces

/verification/
  commands.json                          ← Bootstrap, migration replay, auth smoke
```

---

## 11. Verification Gates (Phase 1)

| Gate | Command | Pass Criteria |
|------|---------|---------------|
| **Migration Replay** | `npx prisma migrate reset --force && npx prisma db seed` | Clean apply, seed 20 leagues + configs |
| **Auth Smoke** | `npm run test:auth` | Superadmin allow, others deny |
| **Daily Run** | `curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/daily-analysis` | Returns runId, status=completed, picksGenerated ≥0 |
| **Unit Tests** | `npm run test:unit` | ≥90% engine coverage, all pass |
| **Integration Tests** | `npm run test:integration` | All API routes pass |
| **Lint/Typecheck/Build** | `npm run lint && npx tsc --noEmit && npm run build` | 0 errors, 0 warnings |

---

## 12. Phase 1 Timeline (2 Weeks)

| Week | Focus | Deliverable |
|------|-------|-------------|
| **1** | Data Foundation | Prisma migrations, seed, API route skeletons, adapters |
| **2** | Engine + Pipeline | 10 market models, cron job, authz, tests, verification gates |

---

## 13. Risks (Phase 1)

| Risk | Mitigation |
|------|------------|
| Free API rate limits (100/day) | Cache 24h, batch requests, monitor usage |
| Missing data (injuries, xG) | Graceful degradation: confidence penalty, not failure |
| Migration on prod | Test on staging, backward-compatible, rollback plan |

---

## 14. Next Phase (Phase 2 — UI & Backtest)

- Superadmin dashboard (tabs, table, drawer)
- Factor breakdown visualization
- Backtest API + calibration report
- Email notifications
- Settings panel

---

**End of Phase 1 PRD** — Ready for Foundation Phase execution.