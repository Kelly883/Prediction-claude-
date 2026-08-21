import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockRbac = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  errorResponse: vi.fn(),
}));

vi.mock('@/lib/rbac', () => mockRbac);

function makeFakeDb() {
  const transactions = new Map<string, any>();
  const webhookEvents = new Map<string, any>();
  let sequence = 0;

  const db: any = {
    transaction: {
      findMany: vi.fn(async ({ where, orderBy, include }: any) => {
        let list = [...transactions.values()].filter((tx) => {
          if (!where.createdAt) return true;
          const created = tx.createdAt?.getTime?.() ?? new Date(tx.createdAt).getTime();
          return created >= where.createdAt.gte.getTime() && created <= where.createdAt.lte.getTime();
        });
        if (orderBy?.createdAt === 'desc') {
          list.sort((a: any, b: any) => (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0));
        }
        if (include?.webhookEvents) {
          list = list.map((tx: any) => ({
            ...tx,
            webhookEvents: [...webhookEvents.values()].filter((we) => we.transactionId === tx.id),
          }));
        }
        return list;
      }),
      count: vi.fn(async ({ where }: any) => {
        return [...transactions.values()].filter((tx) => {
          if (!where.createdAt) return true;
          const created = tx.createdAt?.getTime?.() ?? new Date(tx.createdAt).getTime();
          return created >= where.createdAt.gte.getTime() && created <= where.createdAt.lte.getTime();
        }).length;
      }),
    },
    webhookEvent: {
      findMany: vi.fn(async ({ where }: any) => {
        if (!where.transactionId) return [];
        return [...webhookEvents.values()].filter((we) => we.transactionId === where.transactionId);
      }),
    },
    _seedTx(tx: any) {
      const id = tx.id || `tx-${++sequence}`;
      transactions.set(id, { ...tx, id });
      return id;
    },
    _seedWebhook(we: any) {
      const id = we.id || `we-${++sequence}`;
      webhookEvents.set(id, { ...we, id });
      return id;
    },
    _getTransactions: () => [...transactions.values()],
    _getWebhookEvents: () => [...webhookEvents.values()],
  };

  return db;
}

let fakeDb: ReturnType<typeof makeFakeDb>;

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return fakeDb;
  },
}));

describe('P1-03 Payment Reconciliation', () => {
  beforeEach(() => {
    fakeDb = makeFakeDb();
    mockRbac.requirePermission.mockResolvedValue(undefined);
    mockRbac.errorResponse.mockImplementation((err: any) => {
      const status = err?.status ?? 500;
      return new Response(JSON.stringify({ error: err?.message ?? 'Internal server error' }), { status });
    });
  });

  describe('lib/reconciliation.ts', () => {
    it('generates reconciliation report with summary', async () => {
      const now = new Date();
      const tx1 = fakeDb._seedTx({
        provider: 'paystack',
        providerReference: 'ref-1',
        amount: 5000,
        currency: 'NGN',
        status: 'success',
        createdAt: now,
        updatedAt: now,
        completedAt: now,
      });
      const tx2 = fakeDb._seedTx({
        provider: 'flutterwave',
        providerReference: 'ref-2',
        amount: 3000,
        currency: 'NGN',
        status: 'failed',
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      });

      const { generateReconciliationReport } = await import('@/lib/reconciliation');
      const report = await generateReconciliationReport(new Date(now.getTime() - 1000), new Date(now.getTime() + 1000));

      expect(report.summary.totalTransactions).toBe(2);
      expect(report.summary.totalAmount).toBe('8000');
      expect(report.summary.byStatus['success']?.count).toBe(1);
      expect(report.summary.byStatus['failed']?.count).toBe(1);
      expect(report.summary.byProvider['paystack']?.count).toBe(1);
      expect(report.summary.byProvider['flutterwave']?.count).toBe(1);
    });

    it('flags missing webhooks for successful transactions', async () => {
      const now = new Date();
      const tx1 = fakeDb._seedTx({
        provider: 'paystack',
        providerReference: 'ref-1',
        amount: 5000,
        currency: 'NGN',
        status: 'success',
        createdAt: now,
        updatedAt: now,
        completedAt: now,
      });

      const { generateReconciliationReport } = await import('@/lib/reconciliation');
      const report = await generateReconciliationReport(new Date(now.getTime() - 1000), new Date(now.getTime() + 1000));

      expect(report.missingWebhooks).toHaveLength(1);
      expect(report.missingWebhooks[0].providerReference).toBe('ref-1');
    });

    it('does not flag missing webhooks when webhook exists', async () => {
      const now = new Date();
      const tx1 = fakeDb._seedTx({
        provider: 'paystack',
        providerReference: 'ref-1',
        amount: 5000,
        currency: 'NGN',
        status: 'success',
        createdAt: now,
        updatedAt: now,
        completedAt: now,
      });
      fakeDb._seedWebhook({
        transactionId: tx1,
        provider: 'paystack',
        eventType: 'charge.success',
        providerReference: 'ref-1',
        payload: {},
        processingStatus: 'processed',
      });

      const { generateReconciliationReport } = await import('@/lib/reconciliation');
      const report = await generateReconciliationReport(new Date(now.getTime() - 1000), new Date(now.getTime() + 1000));

      expect(report.missingWebhooks).toHaveLength(0);
    });
  });

  describe('GET /api/admin/reconciliation', () => {
    it('returns 400 for invalid dates', async () => {
      const { GET } = await import('@/app/api/admin/reconciliation/route');
      const req = new NextRequest('http://localhost:3000/api/admin/reconciliation?startDate=invalid&endDate=invalid');
      const res = await GET(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 when startDate > endDate', async () => {
      const { GET } = await import('@/app/api/admin/reconciliation/route');
      const req = new NextRequest('http://localhost:3000/api/admin/reconciliation?startDate=2024-02-01T00:00:00Z&endDate=2024-01-01T00:00:00Z');
      const res = await GET(req);
      expect(res.status).toBe(400);
    });
  });
});
