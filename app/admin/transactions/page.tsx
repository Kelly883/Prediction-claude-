'use client';

import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';
import { CreditCard, ArrowUpRight, CheckCircle2, XCircle, Clock, Calendar } from 'lucide-react';

type Tx = {
  id: string;
  provider: string;
  amount: string;
  currency: string;
  status: string;
  createdAt: string;
  providerReference: string;
};

export default function AdminTransactionsPage() {
  const [txs, setTxs] = useState<Tx[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiJson<Tx[]>(`/api/admin/transactions${filter ? `?status=${filter}` : ''}`)
      .then(setTxs)
      .finally(() => setLoading(false));
  }, [filter]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="pb-2 border-b border-[rgba(243,245,236,0.1)]">
        <h1 className="font-bold text-2xl sm:text-3xl text-white">Payment Transactions</h1>
        <p className="text-xs sm:text-sm text-[var(--chalk-muted)] mt-1">
          Real-time logs of Paystack and Flutterwave gateway charge attempts.
        </p>
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
        <h2 className="text-base font-semibold text-white mb-4 flex items-center justify-between">
          <span>Transactions Archive ({txs.length})</span>
          <span className="text-xs text-[var(--chalk-muted)] font-mono">Gateway Records</span>
        </h2>

        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--chalk-muted)]">
            Loading transactions…
          </div>
        ) : txs.length === 0 ? (
          <div className="p-8 text-center border border-dashed border-[rgba(243,245,236,0.14)] rounded-lg">
            <CreditCard size={28} className="mx-auto mb-2 text-[var(--floodlight)] opacity-80" />
            <p className="text-sm text-white font-medium">No transactions found</p>
            <p className="text-xs text-[var(--chalk-muted)] mt-1">
              Payment records and gateway webhook events will show here.
            </p>
          </div>
        ) : (
          <>
            {/* Desktop / Tablet Table View */}
            <div className="hidden md:block table-container">
              <table className="table-responsive">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Provider</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Date & Time</th>
                  </tr>
                </thead>
                <tbody>
                  {txs.map((t) => (
                    <tr key={t.id}>
                      <td className="mono font-medium text-white">{t.providerReference}</td>
                      <td className="capitalize text-[var(--chalk)]">{t.provider}</td>
                      <td className="mono font-semibold text-white">
                        {t.currency} {Number(t.amount).toLocaleString()}
                      </td>
                      <td>
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${
                            t.status === 'success'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : t.status === 'failed'
                              ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
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
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider shrink-0 ${
                        t.status === 'success'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : t.status === 'failed'
                          ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
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
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
