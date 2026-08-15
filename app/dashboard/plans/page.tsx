'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiJson } from '@/lib/api-client';

type Plan = {
  id: string;
  name: string;
  durationDays: number;
  priceNGN: string | number;
  priceUSDOverride: string | number | null;
  accessScope: 'all' | 'category';
  isActive: boolean;
};

type Subscription = {
  id: string;
  status: string;
  startAt: string;
  endAt: string;
  autoRenew: boolean;
  plan: { id: string; name: string };
};

function formatNaira(value: unknown): string {
  const n = Number(value);
  return `₦${n.toLocaleString('en-NG')}`;
}

export default function DashboardPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState<'paystack' | 'flutterwave'>('paystack');
  const [processingPlanId, setProcessingPlanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.allSettled([
      apiJson<Plan[]>('/api/plans'),
      apiJson<Subscription | null>('/api/me/subscription'),
    ])
      .then(([plansRes, subRes]) => {
        if (plansRes.status === 'fulfilled' && Array.isArray(plansRes.value)) {
          // Only show active plans configured by admin
          setPlans(plansRes.value.filter((p) => p.isActive));
        }
        if (subRes.status === 'fulfilled' && subRes.value) {
          setSubscription(subRes.value);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSubscribe(planId: string) {
    setProcessingPlanId(planId);
    setError(null);
    try {
      const res = await apiJson<{ checkoutUrl: string }>('/api/payments/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId,
          provider: selectedProvider,
        }),
      });

      if (res.checkoutUrl) {
        window.location.href = res.checkoutUrl;
      } else {
        throw new Error('Payment URL not received. Please try again.');
      }
    } catch (err) {
      setError((err as Error).message || 'Failed to initialize payment. Please try again.');
      setProcessingPlanId(null);
    }
  }

  return (
    <>
      <div className="eyebrow" style={{ marginBottom: 6 }}>MEMBERSHIP</div>
      <h1 className="display" style={{ fontSize: 32, marginBottom: 8 }}>Available Plans</h1>
      <p style={{ color: 'var(--chalk-muted)', marginBottom: 28, fontSize: 15 }}>
        Choose a pass to unlock verified football predictions with booking codes.
      </p>

      {subscription && (
        <div className="card" style={{ marginBottom: 24, border: '1px solid var(--floodlight)' }}>
          <div className="eyebrow" style={{ color: 'var(--floodlight)', marginBottom: 4 }}>CURRENT SUBSCRIPTION</div>
          <p className="mono" style={{ fontSize: 18, color: 'var(--chalk)', marginBottom: 4 }}>
            {subscription.plan.name}
          </p>
          <p style={{ color: 'var(--chalk-muted)', fontSize: 13 }}>
            Status: <span style={{ color: 'var(--floodlight)', textTransform: 'capitalize' }}>{subscription.status}</span> ·
            Ends on {new Date(subscription.endAt).toLocaleDateString()}
          </p>
        </div>
      )}

      {error && (
        <div className="card error-text" style={{ marginBottom: 24 }}>
          {error}
        </div>
      )}

      {/* Payment Provider Selection */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>Payment Gateway</h2>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="radio"
              name="provider"
              value="paystack"
              checked={selectedProvider === 'paystack'}
              onChange={() => setSelectedProvider('paystack')}
            />
            <span>Paystack (Cards, Bank Transfer, USSD)</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="radio"
              name="provider"
              value="flutterwave"
              checked={selectedProvider === 'flutterwave'}
              onChange={() => setSelectedProvider('flutterwave')}
            />
            <span>Flutterwave (Cards, Mobile Money, International)</span>
          </label>
        </div>
      </div>

      {loading ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--chalk-muted)' }}>
          Loading plans…
        </div>
      ) : plans.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--chalk-muted)', padding: '40px 20px' }}>
          <p style={{ marginBottom: 12 }}>Plans aren't published yet — check back shortly.</p>
          <Link href="/dashboard" className="btn btn-ghost" style={{ fontSize: 14 }}>
            Back to overview
          </Link>
        </div>
      ) : (
        <div className="plans-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {plans.map((plan) => {
            const isCurrentPlan = subscription?.plan.id === plan.id;
            const isProcessing = processingPlanId === plan.id;
            const usdOverride = plan.priceUSDOverride ? Number(plan.priceUSDOverride) : null;

            return (
              <div key={plan.id} className="ticket" style={isCurrentPlan ? { outline: '2px solid var(--floodlight)' } : undefined}>
                <div className="ticket-torn" />
                <div className="ticket-body">
                  <div className="eyebrow">{plan.durationDays}-DAY PASS</div>
                  <div className="ticket-name">{plan.name}</div>

                  <div className="ticket-price">
                    {formatNaira(plan.priceNGN)}
                    <span> / {plan.durationDays} days</span>
                  </div>

                  {usdOverride ? (
                    <div style={{ fontSize: 13, color: 'var(--chalk-muted)', marginTop: 4 }} className="mono">
                      ${usdOverride.toFixed(2)} for accounts outside Nigeria
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: 'var(--chalk-muted)', marginTop: 4 }}>
                      USD price converted automatically outside Nigeria
                    </div>
                  )}

                  <div className="ticket-perforation" />

                  <ul className="ticket-includes">
                    <li>Full VIP predictions & matchday tips</li>
                    <li>One booking code per post</li>
                    <li>Instant unlock upon successful payment</li>
                  </ul>

                  <button
                    type="button"
                    onClick={() => handleSubscribe(plan.id)}
                    disabled={isProcessing}
                    className="btn btn-primary"
                    style={{ width: '100%' }}
                  >
                    {isProcessing ? 'Connecting to payment…' : isCurrentPlan ? 'Renew this pass' : 'Get this pass'}
                  </button>

                  <div className="ticket-barcode" aria-hidden="true" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
