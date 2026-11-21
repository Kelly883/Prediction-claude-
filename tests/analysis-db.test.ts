import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * Live-Postgres integration tests for the analysis persistence layer.
 *
 * These run only when `TEST_DATABASE_URL` is set (an isolated, disposable test
 * database — never a production database). Replay migrations first:
 *   DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy
 *
 * When the variable is absent the suite is skipped so the default CI run stays
 * hermetic.
 */
const testDbUrl = process.env.TEST_DATABASE_URL;
const describeDb = testDbUrl ? describe : describe.skip;

describeDb('AnalysisResult persistence (live Postgres)', () => {
  let prisma: PrismaClient;

  const runDate = new Date('2099-12-31T00:00:00.000Z');
  const fixtureId = `db-test-fixture-${Date.now()}`;
  let runId = '';

  function row(id: string) {
    return {
      runId,
      fixtureId,
      homeTeam: 'Home FC',
      awayTeam: 'Away FC',
      league: 'PL',
      kickoff: new Date('2099-12-31T15:00:00.000Z'),
      bestMarket: 'MATCH_RESULT' as const,
      bestSelection: 'Home FC',
      bestOdds: 1.91,
      confidence: 82,
      marketScores: [{ market: 'MATCH_RESULT', selection: 'Home FC', odds: 1.91, confidence: 82 }] as unknown as object,
      topFactors: [{ name: 'homeXgVsAwayXg', score: 80, weight: 0.3 }] as unknown as object,
    };
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: testDbUrl } } });
    await prisma.$connect();
    const run = await prisma.analysisRun.create({
      data: { runDate, status: 'running', startedAt: new Date() },
    });
    runId = run.id;
  });

  afterAll(async () => {
    if (runId) {
      await prisma.analysisRun.delete({ where: { id: runId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it('rejects a second simultaneous running run for the same day', async () => {
    await expect(
      prisma.analysisRun.create({ data: { runDate, status: 'running', startedAt: new Date() } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('enforces the (runId, fixtureId) unique guard with skipDuplicates', async () => {
    const first = await prisma.analysisResult.createMany({ data: [row('a')], skipDuplicates: true });
    expect(first.count).toBe(1);

    const second = await prisma.analysisResult.createMany({ data: [row('b')], skipDuplicates: true });
    expect(second.count).toBe(0);

    const stored = await prisma.analysisResult.count({ where: { runId, fixtureId } });
    expect(stored).toBe(1);
  });

  it('rolls back result persistence when the transaction fails', async () => {
    const isolatedFixture = `${fixtureId}-rollback`;
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.analysisResult.createMany({
          data: [{ ...row('c'), fixtureId: isolatedFixture }],
          skipDuplicates: true,
        });
        throw new Error('forced failure');
      }),
    ).rejects.toThrow('forced failure');

    const stored = await prisma.analysisResult.count({ where: { runId, fixtureId: isolatedFixture } });
    expect(stored).toBe(0);
  });

  it('commits results and run finalisation atomically', async () => {
    const commitFixture = `${fixtureId}-commit`;
    await prisma.$transaction(async (tx) => {
      await tx.analysisResult.createMany({
        data: [{ ...row('d'), fixtureId: commitFixture }],
        skipDuplicates: true,
      });
      await tx.analysisRun.update({
        where: { id: runId },
        data: { status: 'completed', fixturesAnalyzed: 1, picksGenerated: 1, completedAt: new Date() },
      });
    });

    const run = await prisma.analysisRun.findUnique({ where: { id: runId } });
    expect(run?.status).toBe('completed');
    expect(run?.picksGenerated).toBe(1);
    const stored = await prisma.analysisResult.count({ where: { runId, fixtureId: commitFixture } });
    expect(stored).toBe(1);
  });
});
