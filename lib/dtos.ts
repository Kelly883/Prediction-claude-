export interface PaymentHistoryDTO {
  id: string;
  provider: 'paystack' | 'flutterwave';
  providerReference: string;
  amount: string;
  currency: 'NGN' | 'USD';
  status: string;
  createdAt: string;
  completedAt: string | null;
}

export interface AdminTransactionDTO {
  id: string;
  userId: string;
  subscriptionId: string | null;
  planId: string | null;
  provider: 'paystack' | 'flutterwave';
  providerReference: string;
  amount: string;
  currency: 'NGN' | 'USD';
  fxRateUsed: string | null;
  status: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  user: {
    id: string;
    name: string;
    email: string;
  };
}

export interface PaymentStatusDTO {
  status: string;
  transactionId: string;
  providerReference: string;
  amount: string;
  currency: 'NGN' | 'USD';
  completedAt: string | null;
  message?: string;
}

export interface SubscriptionDTO {
  id: string;
  userId: string;
  planId: string;
  status: string;
  autoRenew: boolean;
  startAt: string;
  endAt: string;
  createdAt: string;
  updatedAt: string;
  renewalAttempts: number;
  lastRenewalError: string | null;
  renewalStatus: string;
  plan: {
    id: string;
    name: string;
    durationDays: number;
    priceNGN: string;
    priceUSDOverride: string | null;
  };
}

export function toPaymentHistoryDTO(tx: any): PaymentHistoryDTO {
  return {
    id: tx.id,
    provider: tx.provider,
    providerReference: tx.providerReference,
    amount: String(tx.amount),
    currency: tx.currency,
    status: tx.status,
    createdAt: tx.createdAt.toISOString(),
    completedAt: tx.completedAt?.toISOString() ?? null,
  };
}

export function toAdminTransactionDTO(tx: any): AdminTransactionDTO {
  return {
    id: tx.id,
    userId: tx.userId,
    subscriptionId: tx.subscriptionId,
    planId: tx.planId,
    provider: tx.provider,
    providerReference: tx.providerReference,
    amount: String(tx.amount),
    currency: tx.currency,
    fxRateUsed: tx.fxRateUsed ? String(tx.fxRateUsed) : null,
    status: tx.status,
    idempotencyKey: tx.idempotencyKey,
    createdAt: tx.createdAt.toISOString(),
    updatedAt: tx.updatedAt.toISOString(),
    completedAt: tx.completedAt?.toISOString() ?? null,
    user: tx.user ? {
      id: tx.user.id,
      name: tx.user.name,
      email: tx.user.email,
    } : { id: tx.userId, name: '', email: '' },
  };
}

export function toPaymentStatusDTO(tx: any, message?: string): PaymentStatusDTO {
  return {
    status: tx.status,
    transactionId: tx.id,
    providerReference: tx.providerReference,
    amount: String(tx.amount),
    currency: tx.currency,
    completedAt: tx.completedAt?.toISOString() ?? null,
    message,
  };
}

export function toSubscriptionDTO(sub: any): SubscriptionDTO {
  return {
    id: sub.id,
    userId: sub.userId,
    planId: sub.planId,
    status: sub.status,
    autoRenew: sub.autoRenew,
    startAt: sub.startAt.toISOString(),
    endAt: sub.endAt.toISOString(),
    createdAt: sub.createdAt.toISOString(),
    updatedAt: sub.updatedAt.toISOString(),
    renewalAttempts: sub.renewalAttempts,
    lastRenewalError: sub.lastRenewalError,
    renewalStatus: sub.renewalStatus,
    plan: sub.plan ? {
      id: sub.plan.id,
      name: sub.plan.name,
      durationDays: sub.plan.durationDays,
      priceNGN: String(sub.plan.priceNGN),
      priceUSDOverride: sub.plan.priceUSDOverride ? String(sub.plan.priceUSDOverride) : null,
    } : { id: sub.planId, name: '', durationDays: 0, priceNGN: '0', priceUSDOverride: null },
  };
}
