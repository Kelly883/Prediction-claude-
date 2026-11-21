import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  admin: { sub: 'superadmin-1', role: 'superadmin' },
  requireAnalysisAdmin: vi.fn(),
  runDailyAnalysis: vi.fn(),
  writeAudit: vi.fn(),
  analysisResult: {
    findMany: vi.fn(),
    count: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  analysisConfig: {
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  transaction: vi.fn(),
  createPost: vi.fn(),
}));

vi.mock('@/lib/analysis/api-auth', () => ({
  requireAnalysisAdmin: mocks.requireAnalysisAdmin,
}));
vi.mock('@/lib/analysis/run', () => ({
  runDailyAnalysis: mocks.runDailyAnalysis,
}));
vi.mock('@/lib/audit', () => ({
  writeAudit: mocks.writeAudit,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    analysisResult: mocks.analysisResult,
    analysisConfig: mocks.analysisConfig,
    $transaction: mocks.transaction,
  },
}));

import { GET as cronGet, POST as cronPost } from '@/app/api/cron/daily-analysis/route';
import { GET as getResults } from '@/app/api/superadmin/analysis/results/route';
import { POST as publishResult } from '@/app/api/superadmin/analysis/results/[id]/publish/route';
import { PATCH as patchConfig } from '@/app/api/superadmin/analysis/config/route';

type NextRequestInit = NonNullable<ConstructorParameters<typeof NextRequest>[1]>;

function request(path: string, init?: NextRequestInit) {
  return new NextRequest(`http://localhost:3000${path}`, init);
}

describe('daily analysis cron API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAnalysisAdmin.mockResolvedValue(mocks.admin);
    mocks.writeAudit.mockResolvedValue(undefined);
  });

  it('rejects requests without the cron secret', async () => {
    const res = await cronGet(request('/api/cron/daily-analysis'));

    expect(res.status).toBe(401);
    expect(mocks.runDailyAnalysis).not.toHaveBeenCalled();
  });

  it('runs the analysis and writes an audit entry', async () => {
    mocks.runDailyAnalysis.mockResolvedValue({
      runId: 'run-1',
      status: 'completed',
      fixturesAnalyzed: 12,
      picksGenerated: 3,
      alreadyRunning: false,
      errors: [],
    });

    const res = await cronPost(request('/api/cron/daily-analysis', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.CRON_SECRET}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ force: true }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      runId: 'run-1',
      status: 'completed',
      fixturesAnalyzed: 12,
      picksGenerated: 3,
    });
    expect(mocks.runDailyAnalysis).toHaveBeenCalledWith({ force: true });
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'analysis.run',
      targetId: 'run-1',
    }));
  });
});

describe('superadmin analysis results API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAnalysisAdmin.mockResolvedValue(mocks.admin);
    mocks.writeAudit.mockResolvedValue(undefined);
  });

  it('filters results by status, league, and date', async () => {
    mocks.analysisResult.findMany.mockResolvedValue([{ id: 'result-1' }]);
    mocks.analysisResult.count.mockResolvedValue(1);

    const res = await getResults(request('/api/superadmin/analysis/results?status=approved&league=PL&date=2026-11-22'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(1);
    expect(mocks.analysisResult.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: 'approved',
        league: 'PL',
        kickoff: {
          gte: new Date('2026-11-22T00:00:00.000Z'),
          lt: new Date('2026-11-23T00:00:00.000Z'),
        },
      }),
    }));
  });

  it('publishes only approved picks with a booking code', async () => {
    const kickoff = new Date('2026-11-23T15:00:00.000Z');
    mocks.analysisResult.findUnique.mockResolvedValue({
      id: 'result-1',
      homeTeam: 'Arsenal',
      awayTeam: 'Chelsea',
      bestMarket: 'BTTS',
      bestSelection: 'Yes',
      kickoff,
      status: 'approved',
      predictionPostId: null,
    });
    mocks.createPost.mockResolvedValue({ id: 'post-1' });
    mocks.analysisResult.update.mockResolvedValue({ id: 'result-1' });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      predictionPost: { create: mocks.createPost },
      analysisResult: { update: mocks.analysisResult.update },
    }));

    const res = await publishResult(request('/api/superadmin/analysis/results/result-1/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookingCode: 'BC-123' }),
    }), { params: Promise.resolve({ id: 'result-1' }) });

    expect(res.status).toBe(201);
    expect(mocks.createPost).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        bookingCode: 'BC-123',
        createdById: 'superadmin-1',
      }),
    }));
    expect(mocks.analysisResult.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'published' }),
    }));
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'analysis.pick.publish',
      targetId: 'post-1',
    }));
  });

  it('rejects publishing a pick that is still pending', async () => {
    mocks.analysisResult.findUnique.mockResolvedValue({
      id: 'result-2',
      homeTeam: 'A',
      awayTeam: 'B',
      bestMarket: 'MATCH_RESULT',
      bestSelection: 'Home',
      kickoff: new Date('2026-11-23T15:00:00.000Z'),
      status: 'pending',
      predictionPostId: null,
    });

    const res = await publishResult(request('/api/superadmin/analysis/results/result-2/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookingCode: 'BC-123' }),
    }), { params: Promise.resolve({ id: 'result-2' }) });

    expect(res.status).toBe(409);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe('superadmin analysis config API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAnalysisAdmin.mockResolvedValue(mocks.admin);
    mocks.writeAudit.mockResolvedValue(undefined);
  });

  it('validates and stores threshold updates', async () => {
    mocks.analysisConfig.upsert.mockResolvedValue({
      id: 'config-1',
      key: 'confidence_threshold',
      value: 82,
    });

    const res = await patchConfig(request('/api/superadmin/analysis/config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'confidence_threshold', value: 82 }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.configs).toHaveLength(1);
    expect(mocks.analysisConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'confidence_threshold' },
      create: expect.objectContaining({ value: 82 }),
    }));
    expect(mocks.requireAnalysisAdmin).toHaveBeenCalledWith(expect.anything(), true);
  });
});
