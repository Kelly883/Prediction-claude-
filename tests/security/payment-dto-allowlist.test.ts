import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { toPaymentHistoryDTO, toAdminTransactionDTO, toPaymentStatusDTO, toSubscriptionDTO } from '@/lib/dtos';

describe('P0-05 Payment Data Response Allowlisting', () => {
  const now = new Date('2024-01-15T10:00:00Z');

  const sampleTransaction = {
    id: 'tx-1',
    userId: 'user-1',
    subscriptionId: 'sub-1',
    planId: 'plan-1',
    provider: 'paystack',
    providerReference: 'pp_ref_123',
    amount: 5000,
    currency: 'NGN',
    fxRateUsed: 750.5,
    status: 'success',
    idempotencyKey: 'idemp-123',
    rawPayload: { authorization_code: 'AUTH_123', card_token: 'tok_123', secret: 'shhh' },
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
  };

  const sampleSubscription = {
    id: 'sub-1',
    userId: 'user-1',
    planId: 'plan-1',
    status: 'active',
    autoRenew: true,
    startAt: now,
    endAt: new Date('2024-02-15T10:00:00Z'),
    createdAt: now,
    updatedAt: now,
    renewalAttempts: 0,
    lastRenewalError: null,
    renewalStatus: 'idle',
    renewalAuthCode: 'encrypted_auth_code',
    plan: {
      id: 'plan-1',
      name: 'VIP Pass',
      durationDays: 30,
      priceNGN: 5000,
      priceUSDOverride: null,
    },
  };

  it('toPaymentHistoryDTO excludes sensitive fields', () => {
    const dto = toPaymentHistoryDTO(sampleTransaction);
    expect(dto).not.toHaveProperty('rawPayload');
    expect(dto).not.toHaveProperty('idempotencyKey');
    expect(dto).not.toHaveProperty('userId');
    expect(dto).not.toHaveProperty('subscriptionId');
    expect(dto).not.toHaveProperty('planId');
    expect(dto).not.toHaveProperty('fxRateUsed');
    expect(dto).not.toHaveProperty('updatedAt');
    expect(dto).not.toHaveProperty('user');
  });

  it('toPaymentHistoryDTO includes only allowed fields', () => {
    const dto = toPaymentHistoryDTO(sampleTransaction);
    expect(dto).toEqual({
      id: 'tx-1',
      provider: 'paystack',
      providerReference: 'pp_ref_123',
      amount: '5000',
      currency: 'NGN',
      status: 'success',
      createdAt: '2024-01-15T10:00:00.000Z',
      completedAt: '2024-01-15T10:00:00.000Z',
    });
  });

  it('toAdminTransactionDTO excludes sensitive fields', () => {
    const dto = toAdminTransactionDTO(sampleTransaction);
    expect(dto).not.toHaveProperty('rawPayload');
    expect(dto).not.toHaveProperty('authorization_code');
    expect(dto).not.toHaveProperty('card_token');
    expect(dto).not.toHaveProperty('renewalAuthCode');
    expect(dto).not.toHaveProperty('secret');
    expect(dto).not.toHaveProperty('password');
    expect(dto).not.toHaveProperty('cvv');
    expect(dto).not.toHaveProperty('pin');
    expect(dto).not.toHaveProperty('otp');
  });

  it('toAdminTransactionDTO includes allowed admin fields', () => {
    const dto = toAdminTransactionDTO(sampleTransaction);
    expect(dto.id).toBe('tx-1');
    expect(dto.userId).toBe('user-1');
    expect(dto.providerReference).toBe('pp_ref_123');
    expect(dto.amount).toBe('5000');
    expect(dto.user.email).toBe('test@example.com');
  });

  it('toPaymentStatusDTO excludes sensitive fields', () => {
    const dto = toPaymentStatusDTO(sampleTransaction);
    expect(dto).not.toHaveProperty('rawPayload');
    expect(dto).not.toHaveProperty('userId');
    expect(dto).not.toHaveProperty('subscriptionId');
    expect(dto).not.toHaveProperty('idempotencyKey');
  });

  it('toPaymentStatusDTO includes only status fields', () => {
    const dto = toPaymentStatusDTO(sampleTransaction);
    expect(dto).toEqual({
      status: 'success',
      transactionId: 'tx-1',
      providerReference: 'pp_ref_123',
      amount: '5000',
      currency: 'NGN',
      completedAt: '2024-01-15T10:00:00.000Z',
    });
  });

  it('toSubscriptionDTO excludes renewalAuthCode', () => {
    const dto = toSubscriptionDTO(sampleSubscription);
    expect(dto).not.toHaveProperty('renewalAuthCode');
  });

  it('toSubscriptionDTO includes allowed subscription fields', () => {
    const dto = toSubscriptionDTO(sampleSubscription);
    expect(dto.id).toBe('sub-1');
    expect(dto.status).toBe('active');
    expect(dto.plan.name).toBe('VIP Pass');
    expect(dto.renewalAttempts).toBe(0);
  });

  it('negative leak detection: rawPayload never appears in any DTO', () => {
    const paymentDto = toPaymentHistoryDTO(sampleTransaction);
    const adminDto = toAdminTransactionDTO(sampleTransaction);
    const statusDto = toPaymentStatusDTO(sampleTransaction);
    const subDto = toSubscriptionDTO(sampleSubscription);

    [paymentDto, adminDto, statusDto, subDto].forEach((dto) => {
      expect(JSON.stringify(dto)).not.toContain('authorization_code');
      expect(JSON.stringify(dto)).not.toContain('card_token');
      expect(JSON.stringify(dto)).not.toContain('AUTH_123');
      expect(JSON.stringify(dto)).not.toContain('tok_123');
      expect(JSON.stringify(dto)).not.toContain('shhh');
      expect(JSON.stringify(dto)).not.toContain('encrypted_auth_code');
    });
  });
});
