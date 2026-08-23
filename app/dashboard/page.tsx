'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiJson } from '@/lib/api-client';

type Me = { id: string; name: string; email: string; country: string; role: 'admin' | 'user' | 'superadmin'; emailVerified: boolean };
type SubscriptionView = {
  id: string;
  status: string;
  autoRenew: boolean;
  endAt: string;
  plan: { name: string; durationDays: number };
} | null;
type PredictionView = {
  id: string;
  title: string;
  scheduledAt: string;
  locked: boolean;
  matchCount?: number;
  bookingCode?: string;
  items?: { id: string; match: string; prediction: string }[];
};
type PaymentView = { id: string; amount: string; currency: string; status: string; provider: string; createdAt: string };

export default function DashboardPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionView>(null);
  const [predictions, setPredictions] = useState<PredictionView[]>([]);
  const [payments, setPayments] = useState<PaymentView[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [resendingVerification, setResendingVerification] = useState(false);
  const [verificationResent, setVerificationResent] = useState(false);

  useEffect(() => {
    Promise.all([
      apiJson<Me>('/api/me'),
      apiJson<SubscriptionView>('/api/me/subscription'),
      apiJson<PredictionView[]>('/api/predictions'),
      apiJson<PaymentView[]>('/api/me/payments'),
    ])
      .then(([meData, subData, predData, payData]) => {
        setMe(meData);
        setSubscription(subData);
        setPredictions(predData);
        setPayments(payData);
      })
      .finally(() => setLoading(false));
  }, []);

  async function cancelAutoRenew() {
    setCancelling(true);
    try {
      await apiJson('/api/payments/cancel-auto-renew', { method: 'POST' });
      setSubscription((s) => (s ? { ...s, autoRenew: false } : s));
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setCancelling(false);
    }
  }

  async function resendVerification() {
    if (!me) return;
    setResendingVerification(true);
    try {
      const result = await apiJson<{ emailSent: boolean }>('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: me.email }),
      });
      setVerificationResent(result.emailSent);
    } finally {
      setResendingVerification(false);
    }
  }

  if (loading) {
    return (
      <>
        <div className="container section">Loading…</div>
      </>
    );
  }

  return (
    <>

                <div className="eyebrow" style={{ marginBottom: 6 }}>YOUR ACCOUNT</div>
          <h1 className="display" style={{ fontSize: 32, marginBottom: 24 }}>{me?.name ?? me?.email}</h1>

          {me && !me.emailVerified && (
            <div
              className="card"
              style={{ marginBottom: 24, borderColor: 'var(--floodlight)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}
            >
              <div>
                <p style={{ fontWeight: 600, marginBottom: 4 }}>Verify your email address</p>
                <p style={{ color: 'var(--chalk-muted)', fontSize: 13 }}>
                  {verificationResent ? 'Check your inbox for a new link.' : `We haven't confirmed ${me.email} yet.`}
                </p>
                {!verificationResent && (
                  <p style={{ color: 'var(--chalk-muted)', fontSize: 11, marginTop: 4 }}>
                    Not seeing it? Check your spam or junk folder.
                  </p>
                )}
              </div>
              <button
                onClick={resendVerification}
                disabled={resendingVerification || verificationResent}
                className="btn btn-ghost"
                style={{ flexShrink: 0 }}
              >
                {verificationResent ? 'Sent ✓' : resendingVerification ? 'Sending…' : 'Resend verification email'}
              </button>
            </div>
          )}

          {/* Subscription status */}
          <div className="card" style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 18, marginBottom: 16 }}>Subscription</h2>
            {subscription ? (
              <>
                <p className="mono" style={{ fontSize: 20, color: 'var(--floodlight)', marginBottom: 4 }}>
                  {subscription.plan.name}
                </p>
                <p style={{ color: 'var(--chalk-muted)', fontSize: 14, marginBottom: 16 }}>
                  {subscription.status === 'active' ? 'Active' : subscription.status} · renews{' '}
                  {subscription.autoRenew ? 'automatically' : "— won't renew"} · ends{' '}
                  {new Date(subscription.endAt).toLocaleDateString()}
                </p>
                {subscription.autoRenew && (
                  <button onClick={cancelAutoRenew} disabled={cancelling} className="btn btn-ghost">
                    {cancelling ? 'Cancelling…' : 'Cancel auto-renew'}
                  </button>
                )}
              </>
            ) : (
              <>
                <p style={{ color: 'var(--chalk-muted)', marginBottom: 16 }}>You don't have an active plan yet.</p>
                <Link href="/dashboard/plans" className="btn btn-primary">See plans</Link>
              </>
            )}
          </div>

          {/* Predictions feed */}
          <div className="card" style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 18, marginBottom: 16 }}>Latest tips</h2>
            {predictions.length === 0 && <p style={{ color: 'var(--chalk-muted)' }}>No tips published yet.</p>}
            <div style={{ display: 'grid', gap: 12 }}>
              {predictions.map((p) => (
                <div key={p.id} style={{ padding: 16, background: 'var(--pitch)', borderRadius: 4, border: '1px solid rgba(243,245,236,0.1)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <Link href={`/dashboard/predictions/${p.id}`} style={{ color: 'var(--chalk)', textDecoration: 'none' }}>
                      <strong>{p.title}</strong>
                    </Link>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--chalk-muted)' }}>
                      {new Date(p.scheduledAt).toLocaleDateString()}
                    </span>
                  </div>
                  {p.locked ? (
                    <p style={{ marginTop: 8, fontSize: 13, color: 'var(--floodlight)' }}>
                      🔒 {p.matchCount} matches — <Link href="/dashboard/plans" style={{ color: 'var(--floodlight)' }}>subscribe to unlock</Link>
                    </p>
                  ) : (
                    <div style={{ marginTop: 10 }}>
                      <p className="mono" style={{ fontSize: 13, color: 'var(--chalk-muted)', marginBottom: 8 }}>
                        Booking code: <span style={{ color: 'var(--floodlight)' }}>{p.bookingCode}</span>
                      </p>
                      {p.items?.map((item) => (
                        <div key={item.id} style={{ fontSize: 14, display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                          <span>{item.match}</span>
                          <span className="mono" style={{ color: 'var(--chalk-muted)' }}>{item.prediction}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Payment history */}
          <div className="card">
            <h2 style={{ fontSize: 18, marginBottom: 16 }}>Payment history</h2>
            {payments.length === 0 ? (
              <p style={{ color: 'var(--chalk-muted)' }}>No payments yet.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--chalk-muted)', fontSize: 12 }}>
                    <th style={{ padding: '8px 0' }}>Date</th>
                    <th>Provider</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} style={{ borderTop: '1px solid rgba(243,245,236,0.08)' }}>
                      <td style={{ padding: '8px 0' }}>{new Date(p.createdAt).toLocaleDateString()}</td>
                      <td style={{ textTransform: 'capitalize' }}>{p.provider}</td>
                      <td className="mono">{p.currency} {Number(p.amount).toLocaleString()}</td>
                      <td style={{ textTransform: 'capitalize', color: p.status === 'success' ? 'var(--floodlight)' : p.status === 'failed' ? 'var(--card-red)' : 'var(--chalk-muted)' }}>
                        {p.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
    </>
  );
}
