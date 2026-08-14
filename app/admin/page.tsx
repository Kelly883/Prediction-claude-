'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiJson } from '@/lib/api-client';
import { 
  Zap, 
  CreditCard, 
  Users, 
  Sparkles, 
  Activity, 
  FileText, 
  ArrowRight,
  ShieldCheck,
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
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase rounded bg-[rgba(245,179,53,0.16)] text-[#F5B335] border border-[rgba(245,179,53,0.3)]">
              Admin Portal
            </span>
            <span className="text-xs text-[var(--chalk-muted)] flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Live Console
            </span>
          </div>
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
          <Link
            href="/admin/plans"
            className="btn btn-ghost text-xs sm:text-sm py-2 px-3 sm:px-4 inline-flex items-center gap-1.5"
          >
            <Zap size={14} />
            <span>Manage Plans</span>
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

      {/* Quick Actions & Navigation Hub */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link
          href="/admin/plans"
          className="card p-5 hover:border-[var(--floodlight)] transition-colors group cursor-pointer block no-underline"
        >
          <div className="w-10 h-10 rounded-lg bg-[rgba(245,179,53,0.12)] border border-[rgba(245,179,53,0.3)] flex items-center justify-center text-[var(--floodlight)] mb-3">
            <Zap size={20} />
          </div>
          <h3 className="font-semibold text-base text-white group-hover:text-[var(--floodlight)] transition-colors flex items-center justify-between">
            <span>Membership Plans</span>
            <ArrowRight size={16} className="opacity-60 group-hover:translate-x-1 transition-transform" />
          </h3>
          <p className="text-xs text-[var(--chalk-muted)] mt-1.5 leading-relaxed">
            Configure daily, weekly, or VIP passes, set NGN pricing, and automated FX markups.
          </p>
        </Link>

        <Link
          href="/admin/predictions"
          className="card p-5 hover:border-[var(--floodlight)] transition-colors group cursor-pointer block no-underline"
        >
          <div className="w-10 h-10 rounded-lg bg-[rgba(245,179,53,0.12)] border border-[rgba(245,179,53,0.3)] flex items-center justify-center text-[var(--floodlight)] mb-3">
            <Sparkles size={20} />
          </div>
          <h3 className="font-semibold text-base text-white group-hover:text-[var(--floodlight)] transition-colors flex items-center justify-between">
            <span>Matchday Tips & Slips</span>
            <ArrowRight size={16} className="opacity-60 group-hover:translate-x-1 transition-transform" />
          </h3>
          <p className="text-xs text-[var(--chalk-muted)] mt-1.5 leading-relaxed">
            Publish fixtures, booking codes, high-confidence picks, and batch CSV imports.
          </p>
        </Link>

        <Link
          href="/admin/users"
          className="card p-5 hover:border-[var(--floodlight)] transition-colors group cursor-pointer block no-underline"
        >
          <div className="w-10 h-10 rounded-lg bg-[rgba(245,179,53,0.12)] border border-[rgba(245,179,53,0.3)] flex items-center justify-center text-[var(--floodlight)] mb-3">
            <Users size={20} />
          </div>
          <h3 className="font-semibold text-base text-white group-hover:text-[var(--floodlight)] transition-colors flex items-center justify-between">
            <span>User Directory & Grants</span>
            <ArrowRight size={16} className="opacity-60 group-hover:translate-x-1 transition-transform" />
          </h3>
          <p className="text-xs text-[var(--chalk-muted)] mt-1.5 leading-relaxed">
            Track registered users, active subscriptions, export CSV logs, and grant complimentary VIP access.
          </p>
        </Link>
      </div>

      {/* Operations Quick Links */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-white mb-3 uppercase tracking-wider font-mono flex items-center gap-2">
          <ShieldCheck size={16} className="text-[var(--floodlight)]" />
          <span>Operations & Content</span>
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <Link
            href="/admin/free-access"
            className="p-3 rounded bg-[var(--pitch)] border border-[rgba(243,245,236,0.08)] hover:border-[var(--floodlight)] transition-colors text-[var(--chalk)] hover:text-white"
          >
            <div className="font-semibold mb-0.5">Free Access</div>
            <div className="text-[11px] text-[var(--chalk-muted)]">Global trial & promo windows</div>
          </Link>
          <Link
            href="/admin/transactions"
            className="p-3 rounded bg-[var(--pitch)] border border-[rgba(243,245,236,0.08)] hover:border-[var(--floodlight)] transition-colors text-[var(--chalk)] hover:text-white"
          >
            <div className="font-semibold mb-0.5">Transactions</div>
            <div className="text-[11px] text-[var(--chalk-muted)]">Paystack / Korapay logs</div>
          </Link>
          <Link
            href="/admin/cms"
            className="p-3 rounded bg-[var(--pitch)] border border-[rgba(243,245,236,0.08)] hover:border-[var(--floodlight)] transition-colors text-[var(--chalk)] hover:text-white"
          >
            <div className="font-semibold mb-0.5">CMS Copy</div>
            <div className="text-[11px] text-[var(--chalk-muted)]">Homepage banner & FAQ text</div>
          </Link>
          <Link
            href="/admin/audit-logs"
            className="p-3 rounded bg-[var(--pitch)] border border-[rgba(243,245,236,0.08)] hover:border-[var(--floodlight)] transition-colors text-[var(--chalk)] hover:text-white"
          >
            <div className="font-semibold mb-0.5">Audit Log</div>
            <div className="text-[11px] text-[var(--chalk-muted)]">Administrative action trail</div>
          </Link>
        </div>
      </div>
    </div>
  );
}

