CREATE TYPE "AnalysisRunStatus" AS ENUM ('pending', 'running', 'completed', 'failed');

CREATE TYPE "MarketType" AS ENUM ('MATCH_RESULT', 'BTTS', 'OVER_UNDER_2_5', 'ASIAN_HANDICAP', 'DOUBLE_CHANCE', 'CORRECT_SCORE', 'FIRST_HALF_RESULT', 'TOTAL_CORNERS', 'TOTAL_CARDS', 'PLAYER_SCORER');

CREATE TYPE "ResultStatus" AS ENUM ('pending', 'approved', 'dismissed', 'published');

CREATE TABLE "AnalysisRun" (
    "id" TEXT NOT NULL,
    "runDate" DATE NOT NULL,
    "status" "AnalysisRunStatus" NOT NULL DEFAULT 'pending',
    "fixturesAnalyzed" INTEGER NOT NULL DEFAULT 0,
    "picksGenerated" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP,
    "completedAt" TIMESTAMP,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    CONSTRAINT "AnalysisRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnalysisResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "homeTeam" TEXT NOT NULL,
    "awayTeam" TEXT NOT NULL,
    "league" TEXT NOT NULL,
    "kickoff" TIMESTAMP NOT NULL,
    "bestMarket" "MarketType" NOT NULL,
    "bestSelection" TEXT NOT NULL,
    "bestOdds" DECIMAL(6,2) NOT NULL,
    "confidence" DECIMAL(5,2) NOT NULL,
    "marketScores" JSONB NOT NULL,
    "topFactors" JSONB NOT NULL,
    "status" "ResultStatus" NOT NULL DEFAULT 'pending',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP,
    "dismissalReason" TEXT,
    "predictionPostId" TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    CONSTRAINT "AnalysisResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnalysisConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    CONSTRAINT "AnalysisConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeagueConfig" (
    "id" TEXT NOT NULL,
    "leagueName" TEXT NOT NULL,
    "leagueCode" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "marketWeights" JSONB,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    CONSTRAINT "LeagueConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnalysisConfig_key_key" ON "AnalysisConfig"("key");

CREATE UNIQUE INDEX "LeagueConfig_leagueName_key" ON "LeagueConfig"("leagueName");

CREATE UNIQUE INDEX "LeagueConfig_leagueCode_key" ON "LeagueConfig"("leagueCode");

CREATE UNIQUE INDEX "AnalysisResult_predictionPostId_key" ON "AnalysisResult"("predictionPostId");

CREATE INDEX "AnalysisRun_runDate_status_idx" ON "AnalysisRun"("runDate", "status");

CREATE INDEX "AnalysisResult_runId_idx" ON "AnalysisResult"("runId");

CREATE INDEX "AnalysisResult_confidence_idx" ON "AnalysisResult"("confidence");

CREATE INDEX "AnalysisResult_status_idx" ON "AnalysisResult"("status");

ALTER TABLE "AnalysisResult" ADD CONSTRAINT "AnalysisResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnalysisResult" ADD CONSTRAINT "AnalysisResult_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AnalysisResult" ADD CONSTRAINT "AnalysisResult_predictionPostId_fkey" FOREIGN KEY ("predictionPostId") REFERENCES "PredictionPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AnalysisConfig" ADD CONSTRAINT "AnalysisConfig_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
