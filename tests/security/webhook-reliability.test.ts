import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  markWebhookFailed,
  markWebhookProcessed,
  getFailedWebhookEvents,
  getDeadLetteredWebhookEvents,
  retryWebhookEvent,
} from '@/lib/webhook-events';

function makeFakeDb() {
  const events = new Map<string, any>();
  let sequence = 0;

  const db: any = {
    webhookEvent: {
      findUnique: vi.fn(async ({ where }: any) => events.get(where.id) ?? null),
      update: vi.fn(async ({ where, data }: any) => {
        const existing = events.get(where.id);
        if (!existing) throw new Error('Webhook event not found');
        const updated = { ...existing, ...data };
        events.set(where.id, updated);
        return updated;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const existing = events.get(where.id);
        if (!existing) return { count: 0 };
        const updated = { ...existing, ...data };
        events.set(where.id, updated);
        return { count: 1 };
      }),
      findMany: vi.fn(async ({ where, orderBy, take }: any) => {
        let list = [...events.values()].filter((e: any) => {
          if (where.status && e.status !== where.status) return false;
          return true;
        });
        if (orderBy?.receivedAt === 'asc') {
          list.sort((a: any, b: any) => (a.receivedAt?.getTime?.() ?? 0) - (b.receivedAt?.getTime?.() ?? 0));
        }
        return list.slice(0, take ?? list.length);
      }),
      create: vi.fn(async ({ data }: any) => {
        const id = `we-${++sequence}`;
        const record = { id, ...data, createdAt: new Date(), receivedAt: new Date() };
        events.set(id, record);
        return record;
      }),
    },
    _seed(event: any) {
      events.set(event.id, { ...event, receivedAt: event.receivedAt ?? new Date() });
    },
    _getEvents: () => [...events.values()],
  };

  return db;
}

let fakeDb: ReturnType<typeof makeFakeDb>;

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return fakeDb;
  },
}));

describe('P1-05 Webhook Reliability', () => {
  beforeEach(() => {
    fakeDb = makeFakeDb();
  });

  describe('Dead-lettering', () => {
    it('marks event as failed on first error (not dead-lettered)', async () => {
      fakeDb._seed({
        id: 'we-1',
        provider: 'paystack',
        providerEventId: 'evt-1',
        eventType: 'charge.success',
        status: 'processing',
        retryCount: 0,
      });

      await markWebhookFailed('we-1', 'processing error');
      const event = fakeDb._getEvents().find((e: any) => e.id === 'we-1');
      expect(event.status).toBe('failed');
      expect(event.retryCount).toBe(1);
      expect(event.deadLetteredAt).toBeUndefined();
    });

    it('dead-letters event after MAX_WEBHOOK_RETRIES failures', async () => {
      fakeDb._seed({
        id: 'we-2',
        provider: 'paystack',
        providerEventId: 'evt-2',
        eventType: 'charge.success',
        status: 'failed',
        retryCount: 2,
      });

      await markWebhookFailed('we-2', 'final error');
      const event = fakeDb._getEvents().find((e: any) => e.id === 'we-2');
      expect(event.status).toBe('deadLettered');
      expect(event.retryCount).toBe(3);
      expect(event.deadLetteredAt).toBeDefined();
    });
  });

  describe('Retry', () => {
    it('retries a failed webhook event', async () => {
      fakeDb._seed({
        id: 'we-3',
        provider: 'paystack',
        providerEventId: 'evt-3',
        eventType: 'charge.success',
        status: 'failed',
        retryCount: 1,
        errorMessage: 'timeout',
      });

      await retryWebhookEvent('we-3');
      const event = fakeDb._getEvents().find((e: any) => e.id === 'we-3');
      expect(event.status).toBe('received');
      expect(event.retryCount).toBe(0);
      expect(event.errorMessage).toBeNull();
    });

    it('retries a dead-lettered webhook event', async () => {
      fakeDb._seed({
        id: 'we-4',
        provider: 'flutterwave',
        providerEventId: 'evt-4',
        eventType: 'charge.completed',
        status: 'deadLettered',
        retryCount: 3,
        errorMessage: 'permanent failure',
      });

      await retryWebhookEvent('we-4');
      const event = fakeDb._getEvents().find((e: any) => e.id === 'we-4');
      expect(event.status).toBe('received');
      expect(event.retryCount).toBe(0);
      expect(event.errorMessage).toBeNull();
    });

    it('throws for non-retryable statuses', async () => {
      fakeDb._seed({
        id: 'we-5',
        provider: 'paystack',
        providerEventId: 'evt-5',
        eventType: 'charge.success',
        status: 'processed',
        retryCount: 0,
      });

      await expect(retryWebhookEvent('we-5')).rejects.toThrow("Cannot retry webhook event with status: processed");
    });
  });

  describe('Query functions', () => {
    it('getFailedWebhookEvents returns only failed events', async () => {
      fakeDb._seed({ id: 'we-6', provider: 'paystack', providerEventId: 'evt-6', status: 'failed', receivedAt: new Date() });
      fakeDb._seed({ id: 'we-7', provider: 'paystack', providerEventId: 'evt-7', status: 'processed', receivedAt: new Date() });
      fakeDb._seed({ id: 'we-8', provider: 'flutterwave', providerEventId: 'evt-8', status: 'failed', receivedAt: new Date() });

      const failed = await getFailedWebhookEvents();
      expect(failed).toHaveLength(2);
      expect(failed.map((e) => e.id).sort()).toEqual(['we-6', 'we-8']);
    });

    it('getDeadLetteredWebhookEvents returns only dead-lettered events', async () => {
      fakeDb._seed({ id: 'we-9', provider: 'paystack', providerEventId: 'evt-9', status: 'deadLettered', receivedAt: new Date() });
      fakeDb._seed({ id: 'we-10', provider: 'flutterwave', providerEventId: 'evt-10', status: 'failed', receivedAt: new Date() });

      const deadLettered = await getDeadLetteredWebhookEvents();
      expect(deadLettered).toHaveLength(1);
      expect(deadLettered[0].id).toBe('we-9');
    });
  });
});
