'use client';

import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';

type Tx = { id: string; provider: string; amount: string; currency: string; status: string; createdAt: string; providerReference: string };

export default function AdminTransactionsPage() {
  const [txs, setTxs] = useState<Tx[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiJson<Tx[]>(`/api/admin/transactions${filter ? `?status=${filter}` : ''}`).then(setTxs).finally(() => setLoading(false));
  }, [filter]);

  return (
    <>
      <h1 className="display" style={{ fontSize: 28, marginBottom: 20 }}>Transactions</h1>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {['', 'pending', 'success', 'failed'].map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={filter === f ? 'btn btn-primary' : 'btn btn-ghost'} style={{ padding: '6px 14px', fontSize: 13 }}>
            {f === '' ? 'All' : f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      <div className="card">
        {loading ? (
          <p>Loading…</p>
        ) : (
          <div className="table-container">
            <table style={{ width: '100%', minWidth: 500, borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--chalk-muted)', fontSize: 12 }}>
                  <th style={{ padding: '8px 0' }}>Reference</th>
                  <th>Provider</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {txs.map((t) => (
                  <tr key={t.id} style={{ borderTop: '1px solid rgba(243,245,236,0.08)' }}>
                    <td className="mono" style={{ padding: '8px 0' }}>{t.providerReference}</td>
                    <td style={{ textTransform: 'capitalize' }}>{t.provider}</td>
                    <td className="mono">{t.currency} {Number(t.amount).toLocaleString()}</td>
                    <td style={{ textTransform: 'capitalize', color: t.status === 'success' ? 'var(--floodlight)' : t.status === 'failed' ? 'var(--card-red)' : 'var(--chalk-muted)' }}>{t.status}</td>
                    <td>{new Date(t.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
