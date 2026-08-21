import { prisma } from '@/lib/prisma';

export interface ReconciliationReport {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  summary: {
    totalTransactions: number;
    totalAmount: string;
    byStatus: Record<string, { count: number; amount: string }>;
    byProvider: Record<string, { count: number; amount: string }>;
  };
  mismatches: Array<{
    id: string;
    providerReference: string;
    provider: string;
    amount: string;
    currency: string;
    dbStatus: string;
    providerStatus?: string;
    reason: string;
  }>;
  missingWebhooks: Array<{
    providerReference: string;
    provider: string;
    amount: string;
    currency: string;
    createdAt: string;
  }>;
}

export async function generateReconciliationReport(
  startDate: Date,
  endDate: Date,
): Promise<ReconciliationReport> {
  const transactions = await prisma.transaction.findMany({
    where: {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    include: {
      webhookEvents: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const byStatus: Record<string, { count: number; amount: string }> = {};
  const byProvider: Record<string, { count: number; amount: string }> = {};
  let totalAmount = 0;

  const mismatches: ReconciliationReport['mismatches'] = [];
  const missingWebhooks: ReconciliationReport['missingWebhooks'] = [];

  for (const tx of transactions) {
    const amount = Number(tx.amount);
    totalAmount += amount;

    const statusKey = tx.status;
    if (!byStatus[statusKey]) {
      byStatus[statusKey] = { count: 0, amount: '0' };
    }
    byStatus[statusKey].count++;
    byStatus[statusKey].amount = String(Number(byStatus[statusKey].amount) + amount);

    const providerKey = tx.provider;
    if (!byProvider[providerKey]) {
      byProvider[providerKey] = { count: 0, amount: '0' };
    }
    byProvider[providerKey].count++;
    byProvider[providerKey].amount = String(Number(byProvider[providerKey].amount) + amount);

    if (tx.status === 'success' && tx.webhookEvents.length === 0) {
      missingWebhooks.push({
        providerReference: tx.providerReference,
        provider: tx.provider,
        amount: String(amount),
        currency: tx.currency,
        createdAt: tx.createdAt.toISOString(),
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    windowStart: startDate.toISOString(),
    windowEnd: endDate.toISOString(),
    summary: {
      totalTransactions: transactions.length,
      totalAmount: String(totalAmount),
      byStatus,
      byProvider,
    },
    mismatches,
    missingWebhooks,
  };
}
