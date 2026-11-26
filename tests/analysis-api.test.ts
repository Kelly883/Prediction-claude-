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
    updateMany: vi.fn(),
  },
  analysisConfig: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
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
import { PATCH as reviewResult } from '@/app/api/superadmin/analysis/results/[id]/route';
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
      metadata: expect.objectContaining({
        actorType: 'system',
        trigger: 'cron',
        force: true,
      }),
    }));
  });
});

describe('superadmin analysis results API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAnalysisAdmin.mockResolvedValue(mocks.admin);
    mocks.writeAudit.mockResolvedValue(undefined);
    mocks.analysisResult.findMany.mockResolvedValue([]);
    mocks.analysisResult.count.mockResolvedValue(0);
    mocks.analysisResult.findUnique.mockResolvedValue(null);
    mocks.analysisResult.updateMany.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      predictionPost: { create: mocks.createPost },
      analysisResult: {
        findUnique: mocks.analysisResult.findUnique,
        updateMany: mocks.analysisResult.updateMany,
      },
    }));
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
        run: { status: 'completed' },
        kickoff: {
          gte: new Date('2026-11-22T00:00:00.000Z'),
          lt: new Date('2026-11-23T00:00:00.000Z'),
        },
      }),
    }));
    expect(mocks.analysisResult.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ run: { status: 'completed' } }),
    }));
  });

  it('excludes results from failed, running and pending runs from the results list', async () => {
    mocks.analysisResult.findMany.mockResolvedValue([]);
    mocks.analysisResult.count.mockResolvedValue(0);

    await getResults(request('/api/superadmin/analysis/results'));
    const where = mocks.analysisResult.findMany.mock.calls[0]?.[0]?.where;
    expect(where).toMatchObject({ run: { status: 'completed' } });
    expect(mocks.analysisResult.count).toHaveBeenCalledTimes(1);
  });

  it('publishes only approved picks from completed runs with a booking code', async () => {
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
      run: { status: 'completed' },
    });
    mocks.createPost.mockResolvedValue({ id: 'post-1' });

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
    expect(mocks.analysisResult.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'result-1', status: 'approved', predictionPostId: null }),
      data: expect.objectContaining({ status: 'published' }),
    }));
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'analysis.pick.publish',
      targetId: 'post-1',
    }));
  });

  it('rejects publishing a pick from a failed run', async () => {
    mocks.analysisResult.findUnique.mockResolvedValue({
      id: 'result-2',
      homeTeam: 'A',
      awayTeam: 'B',
      bestMarket: 'MATCH_RESULT',
      bestSelection: 'Home',
      kickoff: new Date('2026-11-23T15:00:00.000Z'),
      status: 'approved',
      predictionPostId: null,
      run: { status: 'failed' },
    });

    const res = await publishResult(request('/api/superadmin/analysis/results/result-2/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookingCode: 'BC-123' }),
    }), { params: Promise.resolve({ id: 'result-2' }) });

    expect(res.status).toBe(409);
    expect(mocks.createPost).not.toHaveBeenCalled();
  });

  it('rejects publishing a pick from a running or pending run', async () => {
    for (const runStatus of ['running', 'pending'] as const) {
      mocks.analysisResult.findUnique.mockResolvedValue({
        id: 'result-3',
        homeTeam: 'A',
        awayTeam: 'B',
        bestMarket: 'MATCH_RESULT',
        bestSelection: 'Home',
        kickoff: new Date('2026-11-23T15:00:00.000Z'),
        status: 'approved',
        predictionPostId: null,
        run: { status: runStatus },
      });

      const res = await publishResult(request('/api/superadmin/analysis/results/result-3/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bookingCode: 'BC-123' }),
      }), { params: Promise.resolve({ id: 'result-3' }) });

      expect(res.status).toBe(409);
      expect(mocks.createPost).not.toHaveBeenCalled();
    }
  });

  it('rejects publishing a still-pending pick', async () => {
    mocks.analysisResult.findUnique.mockResolvedValue({
      id: 'result-4',
      homeTeam: 'A',
      awayTeam: 'B',
      bestMarket: 'MATCH_RESULT',
      bestSelection: 'Home',
      kickoff: new Date('2026-11-23T15:00:00.000Z'),
      status: 'pending',
      predictionPostId: null,
      run: { status: 'completed' },
    });

    const res = await publishResult(request('/api/superadmin/analysis/results/result-4/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookingCode: 'BC-123' }),
    }), { params: Promise.resolve({ id: 'result-4' }) });

    expect(res.status).toBe(409);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects publishing a pick that is already published', async () => {
    mocks.analysisResult.findUnique.mockResolvedValue({
      id: 'result-5',
      homeTeam: 'A',
      awayTeam: 'B',
      bestMarket: 'MATCH_RESULT',
      bestSelection: 'Home',
      kickoff: new Date('2026-11-23T15:00:00.000Z'),
      status: 'published',
      predictionPostId: 'post-existing',
      run: { status: 'completed' },
    });

    const res = await publishResult(request('/api/superadmin/analysis/results/result-5/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookingCode: 'BC-123' }),
    }), { params: Promise.resolve({ id: 'result-5' }) });

    expect(res.status).toBe(409);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.createPost).not.toHaveBeenCalled();
  });

  it('rejects publishing when a concurrent request already published the pick', async () => {
    const pick = {
      id: 'result-6',
      homeTeam: 'A',
      awayTeam: 'B',
      bestMarket: 'MATCH_RESULT',
      bestSelection: 'Home',
      kickoff: new Date('2026-11-23T15:00:00.000Z'),
      status: 'approved',
      predictionPostId: null,
      run: { status: 'completed' },
    };
    mocks.analysisResult.findUnique.mockResolvedValue(pick);
    mocks.createPost.mockResolvedValue({ id: 'post-1' });
    // First request publishes; the concurrent request's conditional transition matches nothing.
    mocks.analysisResult.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const first = await publishResult(request('/api/superadmin/analysis/results/result-6/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookingCode: 'BC-123' }),
    }), { params: Promise.resolve({ id: 'result-6' }) });
    const second = await publishResult(request('/api/superadmin/analysis/results/result-6/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookingCode: 'BC-124' }),
    }), { params: Promise.resolve({ id: 'result-6' }) });

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    // Both transactions ran, but only the first conditional transition
    // matched (status: 'approved', predictionPostId: null). In a real
    // database the second transaction rolls its newly created post back,
    // so exactly one post persists.
    expect(mocks.createPost).toHaveBeenCalledTimes(2);
    const rawCalls = mocks.analysisResult.updateMany.mock.calls;
    expect(rawCalls).toHaveLength(2);
    expect(
      rawCalls.every((call) => {
        const where = (call[0] as { where: { predictionPostId: unknown; status: unknown } }).where;
        return where.predictionPostId === null && where.status === 'approved';
      }),
    ).toBe(true);
    // The successful (first) publish sets status: 'published' and links the
    // newly created post id.
    const firstUpdateData = (rawCalls[0][0] as { data: { status: string; predictionPostId: string | null } }).data;
    expect(firstUpdateData.status).toBe('published');
    expect(firstUpdateData.predictionPostId).toBe('post-1');
    expect(
      rawCalls.map((call) => (call[0] as { data: { status: string } }).data.status),
    ).toEqual(['published', 'published']);
  });

  it('rejects publishing a result dismissed before the publishing update', async () => {
    mocks.analysisResult.findUnique.mockResolvedValue({
      id: 'result-8',
      homeTeam: 'A',
      awayTeam: 'B',
      bestMarket: 'MATCH_RESULT',
      bestSelection: 'Home',
      kickoff: new Date('2026-11-23T15:00:00.000Z'),
      status: 'dismissed',
      predictionPostId: null,
      run: { status: 'completed' },
    });

    const res = await publishResult(request('/api/superadmin/analysis/results/result-8/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookingCode: 'BC-123' }),
    }), { params: Promise.resolve({ id: 'result-8' }) });

    expect(res.status).toBe(409);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.createPost).not.toHaveBeenCalled();
  });

  it('rejects publishing when a concurrent dismissal changes the status mid-transaction', async () => {
    const pick = {
      id: 'result-9',
      homeTeam: 'A',
      awayTeam: 'B',
      bestMarket: 'MATCH_RESULT',
      bestSelection: 'Home',
      kickoff: new Date('2026-11-23T15:00:00.000Z'),
      status: 'approved',
      predictionPostId: null,
      run: { status: 'completed' },
    };
    mocks.analysisResult.findUnique.mockResolvedValue(pick);
    // Pre-check passes (approved), but the conditional update matches nothing
    // because the status is no longer 'approved' (concurrent dismissal).
    mocks.analysisResult.updateMany.mockResolvedValueOnce({ count: 0 });

    const res = await publishResult(request('/api/superadmin/analysis/results/result-9/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookingCode: 'BC-123' }),
    }), { params: Promise.resolve({ id: 'result-9' }) });

    expect(res.status).toBe(409);
    expect(mocks.createPost).toHaveBeenCalledTimes(1);
    const rawCalls = mocks.analysisResult.updateMany.mock.calls;
    expect(rawCalls).toHaveLength(1);
    const where = (rawCalls[0][0] as { where: { status: string; predictionPostId: unknown } }).where;
    expect(where.status).toBe('approved');
    expect(where.predictionPostId).toBeNull();
  });

  it('rejects re-publishing an already-published result', async () => {
    mocks.analysisResult.findUnique.mockResolvedValue({
      id: 'result-10',
      homeTeam: 'A',
      awayTeam: 'B',
      bestMarket: 'MATCH_RESULT',
      bestSelection: 'Home',
      kickoff: new Date('2026-11-23T15:00:00.000Z'),
      status: 'published',
      predictionPostId: 'post-existing',
      run: { status: 'completed' },
    });

    const res = await publishResult(request('/api/superadmin/analysis/results/result-10/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookingCode: 'BC-123' }),
    }), { params: Promise.resolve({ id: 'result-10' }) });

    expect(res.status).toBe(409);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.createPost).not.toHaveBeenCalled();
  });

  it('rejects publishing an odds-required market without a captured price', async () => {
    mocks.analysisResult.findUnique.mockResolvedValue({
      id: 'result-7',
      homeTeam: 'A',
      awayTeam: 'B',
      bestMarket: 'ASIAN_HANDICAP',
      bestSelection: 'Home -0.5',
      kickoff: new Date('2026-11-23T15:00:00.000Z'),
      status: 'approved',
      bestOdds: null,
      predictionPostId: null,
      run: { status: 'completed' },
    });

    const res = await publishResult(request('/api/superadmin/analysis/results/result-7/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookingCode: 'BC-123' }),
    }), { params: Promise.resolve({ id: 'result-7' }) });

    expect(res.status).toBe(409);
    expect(mocks.createPost).not.toHaveBeenCalled();
    // The completed-run and odds re-checks happen inside the transaction;
    // the failure is a 409 either way, never a 500.
  });
});

describe('superadmin analysis results review API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAnalysisAdmin.mockResolvedValue(mocks.admin);
    mocks.writeAudit.mockResolvedValue(undefined);
    mocks.analysisResult.findUnique.mockResolvedValue(null);
    mocks.analysisResult.updateMany.mockResolvedValue({ count: 1 });
    mocks.analysisResult.findMany.mockResolvedValue([]);
  });

  function resultRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'result-1',
      homeTeam: 'Arsenal',
      awayTeam: 'Chelsea',
      bestMarket: 'BTTS',
      bestSelection: 'Yes',
      kickoff: new Date('2026-11-23T15:00:00.000Z'),
      status: 'pending',
      predictionPostId: null,
      run: { status: 'completed' },
      ...overrides,
    };
  }

  function requestWithBody(path: string, body: unknown) {
    return reviewResult(request(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }), { params: Promise.resolve({ id: 'result-1' }) });
  }

  it('approves a result from a completed run', async () => {
    const existing = resultRow({ status: 'pending', run: { status: 'completed' } });
    const current = { ...existing, status: 'approved', reviewedById: 'superadmin-1' };
    mocks.analysisResult.findUnique.mockResolvedValueOnce(existing).mockResolvedValueOnce(current);

    const res = await requestWithBody('/api/superadmin/analysis/results/result-1', { status: 'approved' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('approved');
    expect(mocks.analysisResult.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'result-1', status: 'pending' }),
        data: expect.objectContaining({ status: 'approved', reviewedById: 'superadmin-1' }),
      }),
    );
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'analysis.pick.approve',
      targetId: 'result-1',
    }));
  });

  it('rejects approving a result from a failed run', async () => {
    mocks.analysisResult.findUnique.mockResolvedValue(resultRow({ status: 'pending', run: { status: 'failed' } }));

    const res = await requestWithBody('/api/superadmin/analysis/results/result-1', { status: 'approved' });

    expect(res.status).toBe(409);
    expect(mocks.analysisResult.updateMany).not.toHaveBeenCalled();
  });

  it.each([['running'], ['pending']])('rejects approving a result from a %s run', async (runStatus) => {
    mocks.analysisResult.findUnique.mockResolvedValue(resultRow({ status: 'pending', run: { status: runStatus } }));

    const res = await requestWithBody('/api/superadmin/analysis/results/result-1', { status: 'approved' });

    expect(res.status).toBe(409);
    expect(mocks.analysisResult.updateMany).not.toHaveBeenCalled();
  });

  it('allows dismissing a result from a failed run', async () => {
    const existing = resultRow({ status: 'pending', run: { status: 'failed' } });
    const current = { ...existing, status: 'dismissed', reviewedById: 'superadmin-1' };
    mocks.analysisResult.findUnique.mockResolvedValueOnce(existing).mockResolvedValueOnce(current);

    const res = await requestWithBody('/api/superadmin/analysis/results/result-1', {
      status: 'dismissed',
      dismissalReason: 'Insufficient data',
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('dismissed');
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'analysis.pick.dismiss',
      metadata: expect.objectContaining({ dismissalReason: 'Insufficient data' }),
    }));
  });

  it('rejects reviewing an already published pick', async () => {
    mocks.analysisResult.findUnique.mockResolvedValue(resultRow({ status: 'published', run: { status: 'completed' } }));

    const res = await requestWithBody('/api/superadmin/analysis/results/result-1', { status: 'approved' });

    expect(res.status).toBe(409);
    expect(mocks.analysisResult.updateMany).not.toHaveBeenCalled();
  });

  it('requires a dismissal reason when dismissing', async () => {
    mocks.analysisResult.findUnique.mockResolvedValue(resultRow());

    const res = await requestWithBody('/api/superadmin/analysis/results/result-1', { status: 'dismissed' });

    expect(res.status).toBe(400);
    expect(mocks.analysisResult.updateMany).not.toHaveBeenCalled();
  });

  it('rejects approval when another request reviewed the pick first', async () => {
    const existing = resultRow({ status: 'pending', run: { status: 'completed' } });
    mocks.analysisResult.findUnique.mockResolvedValue(existing);
    mocks.analysisResult.updateMany.mockResolvedValue({ count: 0 });

    const res = await requestWithBody('/api/superadmin/analysis/results/result-1', { status: 'approved' });

    expect(res.status).toBe(409);
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });
});

describe('superadmin analysis config API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAnalysisAdmin.mockResolvedValue(mocks.admin);
    mocks.writeAudit.mockResolvedValue(undefined);
    mocks.analysisConfig.findMany.mockResolvedValue([]);
  });

  it('validates and stores threshold updates', async () => {
    mocks.analysisConfig.findMany.mockResolvedValue([{ key: 'confidence_threshold', value: 75 }]);
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
    // Audit records both the previous and new value (before/after trail).
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'analysis.config.update',
      metadata: expect.objectContaining({ key: 'confidence_threshold', previousValue: 75, newValue: 82 }),
    }));
  });

  it('records the previous and new config values in the audit trail', async () => {
    mocks.analysisConfig.findMany.mockResolvedValue([
      { key: 'confidence_threshold', value: 75 },
    ]);
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

    expect(res.status).toBe(200);
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'analysis.config.update',
      metadata: expect.objectContaining({
        key: 'confidence_threshold',
        previousValue: 75,
        newValue: 82,
      }),
    }));
  });

  it('records a null previousValue when the config did not exist', async () => {
    mocks.analysisConfig.findMany.mockResolvedValue([]);
    mocks.analysisConfig.upsert.mockResolvedValue({
      id: 'config-2',
      key: 'confidence_threshold',
      value: 90,
    });

    await patchConfig(request('/api/superadmin/analysis/config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'confidence_threshold', value: 90 }),
    }));

    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ previousValue: null, newValue: 90 }),
    }));
  });
});
