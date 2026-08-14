'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiJson } from '@/lib/api-client';

type Detail = {
  user: { id: string; name: string; email: string; phone: string | null; country: string; role: string; twoFactorEnabled: boolean; createdAt: string };
  subscriptions: { id: string; status: string; autoRenew: boolean; endAt: string; plan: { name: string } }[];
  transactions: { id: string; provider: string; amount: string; currency: string; status: string; createdAt: string }[];
  deviceActivity: { distinctDevicesLast24h: number; anomalous: boolean };
};

export default function AdminUserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiJson<Detail>(`/api/admin/users/${id}`).then(setDetail).finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <>
        <div className="container section">Loading…</div>
      </>
    );
  }

  if (!detail) {
    return (
      <>
        <div className="container section">Not found.</div>
      </>
    );
  }

  const { user, subscriptions, transactions, deviceActivity } = detail;

  return (
    <>
                <h1 className="display" style={{ fontSize: 28, marginBottom: 4 }}>{user.name}</h1>
          <p style={{ color: 'var(--chalk-muted)', fontSize: 14, marginBottom: 24 }}>
            {user.email} · {user.country} · joined {new Date(user.createdAt).toLocaleDateString()} · 2FA {user.twoFactorEnabled ? 'on' : 'off'}
          </p>

          {deviceActivity.anomalous && (
            <div className="card" style={{ borderColor: 'var(--card-red)', marginBottom: 20 }}>
              <p style={{ color: 'var(--card-red)', fontSize: 14 }}>
                ⚠ {deviceActivity.distinctDevicesLast24h} distinct devices seen in the last 24h — worth a manual look
                (design doc's anti-sharing signal; this is informational only, not an automatic block).
              </p>
            </div>
          )}

      <div className="admin-grid-half">
            <div className="card">
              <h2 style={{ fontSize: 16, marginBottom: 12 }}>Subscriptions</h2>
              {subscriptions.length === 0 ? (
                <p style={{ color: 'var(--chalk-muted)', fontSize: 14 }}>No subscriptions.</p>
              ) : (
                subscriptions.map((s) => (
                  <div key={s.id} style={{ padding: '8px 0', borderTop: '1px solid rgba(243,245,236,0.08)', fontSize: 13 }}>
                    <strong>{s.plan.name}</strong> — {s.status}
                    {s.autoRenew ? ', auto-renews' : ', will not renew'}, ends {new Date(s.endAt).toLocaleDateString()}
                  </div>
                ))
              )}
            </div>

            <div className="card">
              <h2 style={{ fontSize: 16, marginBottom: 12 }}>Transactions</h2>
              {transactions.length === 0 ? (
                <p style={{ color: 'var(--chalk-muted)', fontSize: 14 }}>No transactions.</p>
              ) : (
                transactions.map((t) => (
                  <div key={t.id} style={{ padding: '8px 0', borderTop: '1px solid rgba(243,245,236,0.08)', fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
                    <span className="mono">{t.currency} {Number(t.amount).toLocaleString()}</span>
                    <span style={{ textTransform: 'capitalize', color: t.status === 'success' ? 'var(--floodlight)' : t.status === 'failed' ? 'var(--card-red)' : 'var(--chalk-muted)' }}>
                      {t.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
    </>
  );
}
