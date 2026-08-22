'use client';

import { useEffect, useState } from 'react';
import { apiJson, apiFetch } from '@/lib/api-client';
import { CreditCard, ArrowUpRight, CheckCircle2, XCircle, Clock, Calendar, RefreshCw, User } from 'lucide-react';

type Tx = {
  id: string;
  provider: string;
  amount: string;
  currency: string;
  status: string;
  createdAt: string;
  providerReference: string;
  userId?: string;
  user?: { name?: string; email?: string };
};

export default function AdminTransactionsPage() {
  const [txs, setTxs] = useState<Tx[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    setLoading(true);
    apiJson<Tx[]>(`/api/admin/transactions${filter ? `?status=${filter}` : ''}`)
      .then(setTxs)
      .finally(() => setLoading(false));
  }, [filter]);

  async function handleVerify(tx: Tx) {
    if (!tx.providerReference || !tx.provider) return;
    setVerifyingId(tx.id);
    try {
      const res = await apiFetch('/api/admin/payments/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: tx.providerReference, provider: tx.provider }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Verification failed (HTTP ${res.status})`);
      }
      setTxs((prev) =>
        prev.map((t) =>
          t.id === tx.id ? { ...t, status: 'success' } : t
        )
      );
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setVerifyingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="admin-page-header">
        <div className="admin-page-eyebrow">Payment Transactions</div>
        <h1 className="admin-page-title">Payment Transactions</h1>
        <p className="admin-page-subtitle">Real-time logs of Paystack and Flutterwave gateway charge attempts. Use Verify to reconcile debited but pending payments.</p>
        <div className="admin-underline" />
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {[
          { key: '', label: 'All Transactions' },
          { key: 'success', label: 'Successful' },
          { key: 'pending', label: 'Pending / Processing' },
          { key: 'failed', label: 'Failed' },
        ].map((item) => (
          <button
            key={item.key}
            onClick={() => setFilter(item.key)}
            className={`text-xs sm:text-sm py-2 px-3.5 rounded-lg font-medium transition-all min-h-[38px] ${
              filter === item.key
                ? 'bg-[var(--floodlight)] text-[var(--pitch)] font-semibold shadow-sm'
                : 'bg-[var(--turf)] text-[var(--chalk-muted)] hover:text-white border border-[rgba(243,245,236,0.1)]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Main Content Card */}
      <div className="card p-4 sm:p-5">
        <div className="admin-card-header">
          <h2 className="admin-card-title">Transactions Archive ({txs.length})</h2>
          <span className="admin-card-subtitle">Gateway Records</span>
        </div>

        {loading ? (
          <div className="admin-loading">Loading transactions…</div>
        ) : txs.length === 0 ? (
          <div className="admin-empty-state">
            <CreditCard size={28} className="admin-empty-state-icon" />
            <p className="admin-empty-state-title">No transactions found</p>
            <p className="admin-empty-state-desc">Payment records and gateway webhook events will show here.</p>
          </div>
        ) : (
          <>
            {/* Desktop / Tablet Table View */}
            <div className="hidden md:block admin-table-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>User</th>
                    <th>Provider</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Date &amp; Time</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {txs.map((t) => (
                    <tr key={t.id}>
                      <td className="mono font-medium text-white">{t.providerReference}</td>
                      <td className="text-xs text-[var(--chalk)]">
                        {t.user?.name || t.user?.email || t.userId || '—'}
                      </td>
                      <td className="capitalize text-[var(--chalk)]">{t.provider}</td>
                      <td className="mono font-semibold text-white">
                        {t.currency} {Number(t.amount).toLocaleString()}
                      </td>
                      <td>
                        <span
                          className={`admin-status-pill ${
                            t.status === 'success'
                              ? 'admin-status-pill-success'
                              : t.status === 'failed'
                              ? 'admin-status-pill-error'
                              : 'admin-status-pill-warning'
                          }`}
                        >
                          {t.status === 'success' && <CheckCircle2 size={12} />}
                          {t.status === 'failed' && <XCircle size={12} />}
                          {t.status === 'pending' && <Clock size={12} />}
                          {t.status}
                        </span>
                      </td>
                      <td className="text-xs text-[var(--chalk-muted)] font-mono">
                        {new Date(t.createdAt).toLocaleString()}
                      </td>
                      <td>
                        {t.status === 'pending' && (
                          <button
                            onClick={() => handleVerify(t)}
                            disabled={verifyingId === t.id}
                            className="text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[var(--floodlight)] text-[var(--pitch)] font-semibold disabled:opacity-60"
                          >
                            <RefreshCw size={12} className={verifyingId === t.id ? 'animate-spin' : ''} />
                            {verifyingId === t.id ? 'Verifying…' : 'Verify'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards View */}
            <div className="md:hidden space-y-3">
              {txs.map((t) => (
                <div
                  key={t.id}
                  className="p-3.5 rounded-lg bg-[var(--pitch)] border border-[rgba(243,245,236,0.1)] space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-xs text-[var(--chalk-muted)] truncate">
                        {t.providerReference}
                      </div>
                      <div className="text-base font-bold text-white font-mono mt-0.5">
                        {t.currency} {Number(t.amount).toLocaleString()}
                      </div>
                      {t.user?.email && (
                        <div className="flex items-center gap-1 text-xs text-[var(--chalk-muted)] mt-1">
                          <User size={12} />
                          <span className="truncate">{t.user.email}</span>
                        </div>
                      )}
                    </div>
                    <span
                      className={`admin-status-pill ${
                        t.status === 'success'
                          ? 'admin-status-pill-success'
                          : t.status === 'failed'
                          ? 'admin-status-pill-error'
                          : 'admin-status-pill-warning'
                      }`}
                    >
                      {t.status}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-[var(--chalk-muted)] pt-2 border-t border-[rgba(243,245,236,0.06)] font-mono">
                    <span className="capitalize">{t.provider}</span>
                    <span className="flex items-center gap-1">
                      <Calendar size={12} />
                      {new Date(t.createdAt).toLocaleDateString()} {new Date(t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  {t.status === 'pending' && (
                    <button
                      onClick={() => handleVerify(t)}
                      disabled={verifyingId === t.id}
                      className="w-full text-xs flex items-center justify-center gap-1 px-2.5 py-2 rounded-md bg-[var(--floodlight)] text-[var(--pitch)] font-semibold disabled:opacity-60"
                    >
                      <RefreshCw size={12} className={verifyingId === t.id ? 'animate-spin' : ''} />
                      {verifyingId === t.id ? 'Verifying…' : 'Verify Payment'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
