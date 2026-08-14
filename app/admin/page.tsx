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
  Layers,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Info
} from 'lucide-react';

type Health = { stalePendingCount: number; successfulLast24h: number };

function DotGridDecoration() {
  return (
    <div className="absolute right-4 bottom-4 pointer-events-none opacity-25 select-none" aria-hidden="true">
      <svg width="64" height="52" viewBox="0 0 64 52" fill="none">
        {Array.from({ length: 5 }).map((_, r) =>
          Array.from({ length: 6 }).map((_, c) => (
            <circle
              key={`${r}-${c}`}
              cx={c * 11 + 4}
              cy={r * 11 + 4}
              r="1.5"
              fill="#A3D9B8"
            />
          ))
        )}
      </svg>
    </div>
  );
}

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
    <div className="space-y-6 max-w-4xl mx-auto pb-10">
      {/* Top Navigation Tabs */}
      <div className="bg-[#0b2418] border border-[rgba(243,245,236,0.12)] rounded-2xl p-1.5 flex items-center gap-1.5 overflow-x-auto scrollbar-none">
        <Link
          href="/admin"
          className="bg-[#F5B335] text-[#0f2b1d] font-semibold text-sm px-6 py-2 rounded-xl shrink-0 transition-all shadow-sm"
        >
          Overview
        </Link>
        <Link
          href="/admin/plans"
          className="text-[#9fb3a6] hover:text-white font-medium text-sm px-5 py-2 rounded-xl shrink-0 transition-colors"
        >
          Plans
        </Link>
        <Link
          href="/admin/predictions"
          className="text-[#9fb3a6] hover:text-white font-medium text-sm px-5 py-2 rounded-xl shrink-0 transition-colors"
        >
          Predictions
        </Link>
        <Link
          href="/admin/free-access"
          className="text-[#9fb3a6] hover:text-white font-medium text-sm px-5 py-2 rounded-xl shrink-0 transition-colors"
        >
          Free access
        </Link>
      </div>

      {/* Title & Supertitle Header */}
      <div className="pt-2">
        <div className="text-[13px] sm:text-sm text-[#7ea391] font-medium tracking-wide mb-1">
          Admin Portal Live Console
        </div>
        <h1 className="font-bold text-3xl sm:text-4xl text-white tracking-tight">
          System Overview
        </h1>
        <div className="w-12 h-1 bg-[#F5B335] rounded-full mt-3" />
      </div>

      {/* Action Buttons Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        <Link
          href="/admin/predictions"
          className="bg-[#F5B335] text-[#0f2b1d] font-semibold text-sm sm:text-base px-4 py-3.5 rounded-2xl flex items-center justify-between shadow-sm hover:brightness-105 active:scale-[0.99] transition-all no-underline"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#0f2b1d]/10 flex items-center justify-center">
              <Sparkles size={16} className="text-[#0f2b1d]" />
            </div>
            <span>New Prediction</span>
          </div>
          <ArrowRight size={18} className="text-[#0f2b1d]" />
        </Link>

        <Link
          href="/admin/plans"
          className="bg-[#123122] text-white border border-[rgba(243,245,236,0.16)] font-semibold text-sm sm:text-base px-4 py-3.5 rounded-2xl flex items-center justify-between hover:bg-[#163a29] hover:border-[rgba(245,179,53,0.4)] active:scale-[0.99] transition-all no-underline"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[rgba(245,179,53,0.12)] border border-[rgba(245,179,53,0.3)] flex items-center justify-center text-[#F5B335]">
              <Zap size={15} />
            </div>
            <span>Manage Plans</span>
          </div>
          <ArrowRight size={18} className="text-white opacity-80" />
        </Link>
      </div>

      {/* Metric Cards Stack */}
      <div className="space-y-4 pt-1">
        {/* Card 1: 24h Transactions */}
        <div className="relative bg-[#102d1f] border border-[rgba(243,245,236,0.14)] rounded-2xl p-5 sm:p-6 overflow-hidden">
          <DotGridDecoration />
          <div className="flex items-start gap-4 sm:gap-5 relative z-10">
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-[#163d2a] border border-[rgba(245,179,53,0.25)] flex items-center justify-center text-[#F5B335] shrink-0">
              <CreditCard size={22} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-sm sm:text-base font-semibold text-white">
                  <span>24h Transactions</span>
                  <Info size={14} className="text-[#7ea391]" />
                </div>
                <span className="px-2.5 py-0.5 text-xs font-mono rounded border border-emerald-500/40 text-emerald-400 bg-emerald-500/10">
                  24h
                </span>
              </div>
              <div className="text-3xl sm:text-4xl font-bold font-mono text-white my-1.5">
                {loading ? '—' : health?.successfulLast24h ?? 0}
              </div>
              <div className="text-xs sm:text-sm text-[#8ea89b] flex items-center gap-1.5">
                <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
                <span>Successful checkouts</span>
              </div>
            </div>
          </div>
        </div>

        {/* Card 2: Pending Webhooks */}
        <div className="relative bg-[#102d1f] border border-[rgba(243,245,236,0.14)] rounded-2xl p-5 sm:p-6 overflow-hidden">
          <DotGridDecoration />
          <div className="flex items-start gap-4 sm:gap-5 relative z-10">
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-[#163d2a] border border-[rgba(245,179,53,0.25)] flex items-center justify-center text-emerald-400 shrink-0">
              <Activity size={22} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-sm sm:text-base font-semibold text-white">
                  <span>Pending Webhooks</span>
                  <Info size={14} className="text-[#7ea391]" />
                </div>
                <span className="px-2.5 py-0.5 text-xs font-mono rounded border border-emerald-500/40 text-emerald-400 bg-emerald-500/10">
                  Live
                </span>
              </div>
              <div className={`text-3xl sm:text-4xl font-bold font-mono my-1.5 ${(health?.stalePendingCount ?? 0) > 0 ? 'text-[var(--card-red)]' : 'text-white'}`}>
                {loading ? '—' : health?.stalePendingCount ?? 0}
              </div>
              <div className="text-xs sm:text-sm text-[#8ea89b] flex items-center gap-1.5">
                {(health?.stalePendingCount ?? 0) > 0 ? (
                  <>
                    <AlertTriangle size={15} className="text-[var(--card-red)] shrink-0" />
                    <span className="text-[var(--card-red)]">Requires webhook check</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
                    <span>All gateways operational</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Card 3: Active Plans */}
        <div className="relative bg-[#102d1f] border border-[rgba(243,245,236,0.14)] rounded-2xl p-5 sm:p-6 overflow-hidden">
          <DotGridDecoration />
          <div className="flex items-start gap-4 sm:gap-5 relative z-10">
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-[#163d2a] border border-[rgba(245,179,53,0.25)] flex items-center justify-center text-[#F5B335] shrink-0">
              <Layers size={22} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-sm sm:text-base font-semibold text-white">
                  <span>Active Plans</span>
                  <Info size={14} className="text-[#7ea391]" />
                </div>
                <span className="px-2.5 py-0.5 text-xs font-mono rounded border border-emerald-500/40 text-emerald-400 bg-emerald-500/10">
                  Active
                </span>
              </div>
              <div className="text-3xl sm:text-4xl font-bold font-mono text-white my-1.5">
                {loading ? '—' : counts?.plans ?? 0}
              </div>
              <div className="text-xs sm:text-sm pt-0.5">
                <Link 
                  href="/admin/plans" 
                  className="text-[#F5B335] hover:text-amber-300 underline underline-offset-4 font-medium inline-flex items-center gap-1"
                >
                  <span>Manage pricing</span>
                  <ArrowRight size={13} />
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Card 4: Tip Feeds */}
        <div className="relative bg-[#102d1f] border border-[rgba(243,245,236,0.14)] rounded-2xl p-5 sm:p-6 overflow-hidden">
          <DotGridDecoration />
          <div className="flex items-start gap-4 sm:gap-5 relative z-10">
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-[#163d2a] border border-[rgba(245,179,53,0.25)] flex items-center justify-center text-[#F5B335] shrink-0">
              <FileText size={22} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-sm sm:text-base font-semibold text-white">
                  <span>Tip Feeds</span>
                  <Info size={14} className="text-[#7ea391]" />
                </div>
                <span className="px-2.5 py-0.5 text-xs font-mono rounded border border-emerald-500/40 text-emerald-400 bg-emerald-500/10">
                  All
                </span>
              </div>
              <div className="text-3xl sm:text-4xl font-bold font-mono text-white my-1.5">
                {loading ? '—' : counts?.posts ?? 0}
              </div>
              <div className="text-xs sm:text-sm pt-0.5">
                <Link 
                  href="/admin/predictions" 
                  className="text-[#F5B335] hover:text-amber-300 underline underline-offset-4 font-medium inline-flex items-center gap-1"
                >
                  <span>View match posts</span>
                  <ArrowRight size={13} />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


