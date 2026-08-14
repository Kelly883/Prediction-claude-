'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiJson } from '@/lib/api-client';
import { 
  Zap, 
  CreditCard, 
  Sparkles, 
  Activity, 
  FileText, 
  ArrowRight,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';

type Health = { stalePendingCount: number; successfulLast24h: number };

export default function AdminOverviewPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [counts, setCounts] = useState<{ plans: number; posts: number; users: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiJson<Health>('/api/admin/webhooks/health').catch(() => ({ stalePendingCount: 0, successfulLast24h: 0 })),
      Promise.all([
        apiJson<any[]>('/api/plans').catch(() => []),
        apiJson<any[]>('/api/predictions').catch(() => []),
        apiJson<any[]>('/api/admin/users').catch(() => []),
      ]),
    ])
      .then(([healthData, [plans, posts, users]]) => {
        setHealth(healthData);
        setCounts({
          plans: plans.length,
          posts: posts.length,
          users: users.length,
        });
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-[rgba(243,245,236,0.1)]">
        <div>
          <h1 className="font-bold text-2xl sm:text-3xl text-white">System Overview</h1>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/admin/predictions"
            className="btn btn-primary text-xs sm:text-sm py-2 px-3 sm:px-4 inline-flex items-center gap-1.5"
          >
            <Sparkles size={14} />
            <span>New Prediction</span>
          </Link>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-5">
          <div className="flex items-center justify-between text-xs text-[var(--chalk-muted)] font-mono uppercase tracking-wider mb-2">
            <span>24h Transactions</span>
            <CreditCard size={16} className="text-[var(--floodlight)]" />
          </div>
          <div className="font-mono text-3xl font-bold text-[var(--floodlight)]">
            {loading ? '—' : health?.successfulLast24h ?? 0}
          </div>
          <div className="text-xs text-[var(--chalk-muted)] mt-2 flex items-center gap-1">
            <CheckCircle2 size={13} className="text-emerald-400" />
            <span>Successful checkouts</span>
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between text-xs text-[var(--chalk-muted)] font-mono uppercase tracking-wider mb-2">
            <span>Pending Webhooks</span>
            <Activity size={16} className="text-amber-400" />
          </div>
          <div className={`font-mono text-3xl font-bold ${(health?.stalePendingCount ?? 0) > 0 ? 'text-[var(--card-red)]' : 'text-emerald-400'}`}>
            {loading ? '—' : health?.stalePendingCount ?? 0}
          </div>
          <div className="text-xs text-[var(--chalk-muted)] mt-2">
            {(health?.stalePendingCount ?? 0) > 0 ? (
              <span className="text-[var(--card-red)] flex items-center gap-1">
                <AlertTriangle size={13} />
                Requires webhook check
              </span>
            ) : (
              <span className="text-emerald-400">All gateways operational</span>
            )}
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between text-xs text-[var(--chalk-muted)] font-mono uppercase tracking-wider mb-2">
            <span>Active Plans</span>
            <Zap size={16} className="text-[var(--floodlight)]" />
          </div>
          <div className="font-mono text-3xl font-bold text-white">
            {loading ? '—' : counts?.plans ?? 0}
          </div>
          <div className="text-xs text-[var(--chalk-muted)] mt-2">
            <Link href="/admin/plans" className="text-[var(--floodlight)] hover:underline inline-flex items-center gap-1">
              <span>Manage pricing</span>
              <ArrowRight size={11} />
            </Link>
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between text-xs text-[var(--chalk-muted)] font-mono uppercase tracking-wider mb-2">
            <span>Tip Feeds</span>
            <FileText size={16} className="text-[var(--floodlight)]" />
          </div>
          <div className="font-mono text-3xl font-bold text-white">
            {loading ? '—' : counts?.posts ?? 0}
          </div>
          <div className="text-xs text-[var(--chalk-muted)] mt-2">
            <Link href="/admin/predictions" className="text-[var(--floodlight)] hover:underline inline-flex items-center gap-1">
              <span>View match posts</span>
              <ArrowRight size={11} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

