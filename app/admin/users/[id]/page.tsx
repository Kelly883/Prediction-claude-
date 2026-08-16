'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
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
  CheckCircle2,
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
      <div className="admin-loading">
        Loading user profile…
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="admin-empty-state">
        <AlertTriangle size={28} className="text-red-400" style={{ marginBottom: 8 }} />
        <p className="admin-empty-state-title">User account not found</p>
        <Link href="/admin/users" className="admin-back-btn">
          <ArrowLeft size={13} />
          <span>Back to users</span>
        </Link>
      </div>
    );
  }

  const { user, subscriptions, transactions, deviceActivity } = detail;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-[rgba(243,245,236,0.1)]">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/admin/users"
            className="admin-back-btn"
            title="Back to Users"
          >
            <ArrowLeft size={16} />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-bold text-xl sm:text-2xl text-white truncate">
                {user.name}
              </h1>
              {user.role === 'admin' && (
                <span className="admin-status-pill admin-status-pill-warning">Admin</span>
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
        <div className="admin-compose-card">
          <div className="admin-card-header">
            <h2 className="admin-card-title">Subscriptions ({subscriptions.length})</h2>
            <span className="admin-card-subtitle">Pass History</span>
          </div>

          {subscriptions.length === 0 ? (
            <p className="text-xs text-[var(--chalk-muted)] py-4 text-center">No subscription history for this user.</p>
          ) : (
            <div className="flex flex-col gap-2.5">
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
                    className={`admin-status-pill ${s.status === 'active' ? 'admin-status-pill-success' : 'admin-status-pill-neutral'}`}
                  >
                    {s.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="admin-compose-card">
          <div className="admin-card-header">
            <h2 className="admin-card-title">Transactions ({transactions.length})</h2>
            <span className="admin-card-subtitle">Charge Attempts</span>
          </div>

          {transactions.length === 0 ? (
            <p className="text-xs text-[var(--chalk-muted)] py-4 text-center">No transactions on record.</p>
          ) : (
            <div className="flex flex-col gap-2.5">
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
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
