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

export default function SubscriptionCTA() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiJson<Plan[]>('/api/plans')
      .then((data) => {
        if (!cancelled) setPlans(Array.isArray(data) ? data.filter((p) => p.isActive) : []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load plans.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const formatNaira = (value: unknown): string => {
    const n = Number(value);
    return `₦${n.toLocaleString('en-NG')}`;
  }

const formatUSD = (value: unknown): string => {
    const n = Number(value);
    return `$${n.toLocaleString('en-US')}`;
  };

  if (plans === null) {
    return (
      <section style={{ padding: '80px 0', background: '#07110F' }}>
        <div className="container">
          <div style={{ display: 'flex', justifyContent: 'center', gap: 16, padding: '40px 0' }}>
            <div style={{ width: 20, height: 20, border: '2px solid rgba(24, 201, 100, 0.3)', borderTopColor: '#18C964', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
            <span style={{ color: 'var(--chalk-muted)', fontSize: 14 }}>Loading plans…</span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section style={{ padding: '80px 0', background: '#0B1C17' }}>
      <div className="container">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', textAlign: 'center', marginBottom: 40 }}>
          <p style={{ fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.18em', fontSize: 12, color: '#18C964', fontWeight: 600, margin: 0 }}>
            Subscription
          </p>
          <h2 style={{ fontSize: 'clamp(26px, 4vw, 36px)', lineHeight: 1.1, fontWeight: 800, color: '#FFFFFF', margin: 0 }}>
            Choose a plan that works for you.
          </h2>
          <p style={{ fontSize: 15, color: 'var(--chalk-muted)', lineHeight: 1.6, margin: '12px 0 0', maxWidth: 560 }}>
            Get access to football predictions and matchday insights with flexible subscription options.
            Prices shown in NGN; accounts outside Nigeria are charged in USD at the current rate.
          </p>
        </div>

        {error ? (
          <div style={{ padding: 32, background: '#07110F', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, textAlign: 'center', color: 'var(--chalk-muted)' }}>
            <p style={{ margin: '0 0 16px' }}>{error}</p>
          </div>
        ) : plans.length === 0 ? (
          <div style={{ padding: 48, background: '#07110F', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, textAlign: 'center' }}>
            <p style={{ color: 'var(--chalk-muted)', fontSize: 16, margin: '0 0 16px' }}>No subscription plans available at the moment.</p>
            <p style={{ color: 'var(--chalk-muted)', fontSize: 14, margin: 0 }}>Check back shortly or contact support.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            {plans.map((plan) => {
              const usdOverride = plan.priceUSDOverride ? Number(plan.priceUSDOverride) : null;
              return (
                <div
                  key={plan.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 16,
                    padding: 26,
                    background: '#07110F',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 12,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--chalk-muted)' }}>
                      {plan.durationDays}-Day Pass
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#18C964', padding: '2px 8px', borderRadius: 6, background: 'rgba(24, 201, 100, 0.10)', border: '1px solid rgba(24, 201, 100, 0.20)' }}>
                      Active
                    </span>
                  </div>
                  <h3 style={{ fontSize: 18, fontWeight: 700, color: '#FFFFFF', margin: '0 0 10px', letterSpacing: '-0.01em' }}>
                    {plan.name}
                  </h3>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#FFFFFF', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
                    {formatNaira(plan.priceNGN)}
                  </div>
                  {usdOverride ? (
                    <div style={{ fontSize: 13, color: 'var(--chalk-muted)', marginBottom: 10, fontFamily: 'var(--font-mono)' }}>
                      ${usdOverride.toFixed(2)} for accounts outside Nigeria
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: 'var(--chalk-muted)', marginBottom: 10 }}>
                      USD price converted automatically outside Nigeria
                    </div>
                  )}
                  <Link
                    href="/pricing"
                    style={{
                      textDecoration: 'none',
                      display: 'block',
                      textAlign: 'center',
                      fontSize: 14,
                      fontWeight: 700,
                      padding: '12px 20px',
                      background: '#18C964',
                      color: '#07110F',
                      borderRadius: 8,
                    }}
                  >
                    View Subscription Plans
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
