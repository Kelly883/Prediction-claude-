'use client';

import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';

type Health = { stalePendingCount: number; successfulLast24h: number };

export default function AdminOverviewPage() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    apiJson<Health>('/api/admin/webhooks/health').then(setHealth).catch(() => {});
  }, []);

  return (
    <>
      <h1 className="display" style={{ fontSize: 28, marginBottom: 24 }}>Overview</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, maxWidth: 640 }}>
        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 8 }}>SUCCESSFUL PAYMENTS (24H)</div>
          <div className="mono" style={{ fontSize: 32, color: 'var(--floodlight)' }}>{health?.successfulLast24h ?? '—'}</div>
        </div>
        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 8 }}>STALE PENDING TRANSACTIONS</div>
          <div className="mono" style={{ fontSize: 32, color: health && health.stalePendingCount > 0 ? 'var(--card-red)' : 'var(--floodlight)' }}>
            {health?.stalePendingCount ?? '—'}
          </div>
          {health && health.stalePendingCount > 0 && (
            <p style={{ fontSize: 12, color: 'var(--chalk-muted)', marginTop: 8 }}>
              Transactions pending &gt;30min — possible webhook delivery issue.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
