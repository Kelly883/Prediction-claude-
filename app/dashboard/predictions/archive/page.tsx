'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiJson } from '@/lib/api-client';

type SubscriptionView = {
  id: string;
  status: string;
  autoRenew: boolean;
  endAt: string;
  plan: { name: string; durationDays: number };
} | null;

type PredictionItem = { id: string; match: string; prediction: string };
type PredictionView = {
  id: string;
  title: string;
  scheduledAt: string;
  locked: boolean;
  matchCount?: number;
  bookingCode?: string;
  items?: PredictionItem[];
  outcome?: string;
};

export default function DashboardArchivePage() {
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState<SubscriptionView>(null);
  const [predictions, setPredictions] = useState<PredictionView[]>([]);

  useEffect(() => {
    Promise.all([
      apiJson<SubscriptionView>('/api/me/subscription'),
      apiJson<PredictionView[]>('/api/predictions/archive'),
    ])
      .then(([subData, predData]) => {
        setSubscription(subData);
        setPredictions(predData);
      })
      .finally(() => setLoading(false));
  }, []);

  const hasActiveSubscription = Boolean(subscription && subscription.status === 'active');

  if (loading) {
    return <div className="admin-loading">Loading archive…</div>;
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>ARCHIVE</div>
      <h1 className="display" style={{ fontSize: 28, marginBottom: 24 }}>Prediction Archive</h1>

      <div className="card">
        {predictions.length === 0 ? (
          <p style={{ color: 'var(--chalk-muted)' }}>No archived predictions yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {predictions.map((p) => (
              <div
                key={p.id}
                style={{
                  padding: 16,
                  background: 'var(--pitch)',
                  borderRadius: 4,
                  border: '1px solid rgba(243,245,236,0.1)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 600, color: 'var(--chalk)' }}>{p.title}</span>
                    {p.outcome && (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          padding: '2px 8px',
                          borderRadius: 999,
                          background: p.outcome === 'won' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                          color: p.outcome === 'won' ? '#10b981' : '#ef4444',
                        }}
                      >
                        {p.outcome}
                      </span>
                    )}
                  </div>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--chalk-muted)' }}>
                    {new Date(p.scheduledAt).toLocaleDateString()}
                  </span>
                </div>

                {p.locked ? (
                  <div style={{ marginTop: 10 }}>
                    <p style={{ fontSize: 13, color: 'var(--floodlight)', marginBottom: 8 }}>
                      This prediction is locked.
                    </p>
                    {!hasActiveSubscription ? (
                      <Link href="/dashboard/plans" className="btn btn-primary" style={{ padding: '8px 12px', fontSize: 12 }}>
                        Subscribe to unlock
                      </Link>
                    ) : (
                      <p style={{ fontSize: 12, color: 'var(--chalk-muted)' }}>
                        Your current plan does not cover this prediction.
                      </p>
                    )}
                  </div>
                ) : (
                  <div style={{ marginTop: 10 }}>
                    {p.bookingCode && (
                      <p className="mono" style={{ fontSize: 13, color: 'var(--chalk-muted)', marginBottom: 8 }}>
                        Booking code: <span style={{ color: 'var(--floodlight)' }}>{p.bookingCode}</span>
                      </p>
                    )}
                    {p.items?.length ? (
                      <div style={{ display: 'grid', gap: 4 }}>
                        {p.items.map((item) => (
                          <div key={item.id} style={{ fontSize: 14, display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                            <span>{item.match}</span>
                            <span className="mono" style={{ color: 'var(--chalk-muted)' }}>{item.prediction}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
