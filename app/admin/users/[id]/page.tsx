'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { apiJson } from '@/lib/api-client';
import { 
  ArrowLeft, 
  User, 
  Mail, 
  Phone, 
  Globe, 
  Calendar, 
  ShieldCheck, 
  CreditCard, 
  AlertTriangle,
  Clock,
  CheckCircle2
} from 'lucide-react';

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
      <div className="p-8 text-center text-sm text-[var(--chalk-muted)]">
        Loading user profile…
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="p-8 text-center border border-dashed border-[rgba(243,245,236,0.14)] rounded-lg">
        <AlertTriangle size={28} className="mx-auto mb-2 text-red-400" />
        <p className="text-sm text-white font-medium">User account not found</p>
        <Link href="/admin/users" className="btn btn-ghost text-xs mt-3 inline-flex items-center gap-1.5">
          <ArrowLeft size={13} />
          <span>Back to users</span>
        </Link>
      </div>
    );
  }

  const { user, subscriptions, transactions, deviceActivity } = detail;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-[rgba(243,245,236,0.1)]">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/users"
            className="p-2 rounded-lg bg-[var(--turf)] text-[var(--chalk-muted)] hover:text-white border border-[rgba(243,245,236,0.1)] transition-colors"
            title="Back to Users"
          >
            <ArrowLeft size={16} />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-xl sm:text-2xl text-white truncate max-w-md">
                {user.name}
              </h1>
              {user.role === 'admin' && (
                <span className="px-2 py-0.5 text-[9px] font-bold uppercase rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Admin
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-[var(--chalk-muted)] mt-1 flex-wrap font-mono">
              <span className="flex items-center gap-1">
                <Mail size={12} />
                {user.email}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Globe size={12} />
                {user.country}
              </span>
              <span>•</span>
              <span>2FA: {user.twoFactorEnabled ? 'Enabled' : 'Disabled'}</span>
            </div>
          </div>
        </div>
      </div>

      {deviceActivity.anomalous && (
        <div className="p-4 rounded-lg bg-red-950/40 border border-red-500/40 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-red-300">Anomalous Device Activity Detected</h3>
            <p className="text-xs text-red-200/80 mt-0.5">
              {deviceActivity.distinctDevicesLast24h} distinct devices accessed this account in the last 24 hours (anti-credential sharing alert).
            </p>
          </div>
        </div>
      )}

      <div className="admin-grid-half">
        {/* Subscriptions History */}
        <div className="card p-4 sm:p-5 space-y-4">
          <h2 className="text-base font-semibold text-white flex items-center justify-between">
            <span>Subscriptions ({subscriptions.length})</span>
            <span className="text-xs text-[var(--chalk-muted)] font-mono">Pass History</span>
          </h2>

          {subscriptions.length === 0 ? (
            <p className="text-xs text-[var(--chalk-muted)] py-4 text-center">
              No subscription history for this user.
            </p>
          ) : (
            <div className="space-y-2.5">
              {subscriptions.map((s) => (
                <div
                  key={s.id}
                  className="p-3 rounded-lg bg-[var(--pitch)] border border-[rgba(243,245,236,0.08)] flex items-center justify-between text-xs gap-2"
                >
                  <div>
                    <div className="font-semibold text-white">{s.plan.name}</div>
                    <div className="text-[11px] text-[var(--chalk-muted)] mt-0.5 font-mono">
                      Ends: {new Date(s.endAt).toLocaleDateString()} {s.autoRenew ? '(Auto-renews)' : ''}
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded ${
                      s.status === 'active'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-zinc-700/40 text-zinc-400 border border-zinc-700'
                    }`}
                  >
                    {s.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Transactions History */}
        <div className="card p-4 sm:p-5 space-y-4">
          <h2 className="text-base font-semibold text-white flex items-center justify-between">
            <span>Transactions ({transactions.length})</span>
            <span className="text-xs text-[var(--chalk-muted)] font-mono">Charge Attempts</span>
          </h2>

          {transactions.length === 0 ? (
            <p className="text-xs text-[var(--chalk-muted)] py-4 text-center">
              No transactions on record.
            </p>
          ) : (
            <div className="space-y-2.5">
              {transactions.map((t) => (
                <div
                  key={t.id}
                  className="p-3 rounded-lg bg-[var(--pitch)] border border-[rgba(243,245,236,0.08)] flex items-center justify-between text-xs gap-2"
                >
                  <div>
                    <div className="font-bold text-white font-mono">
                      {t.currency} {Number(t.amount).toLocaleString()}
                    </div>
                    <div className="text-[11px] text-[var(--chalk-muted)] capitalize mt-0.5">
                      {t.provider} • {new Date(t.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded ${
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
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
