'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiJson } from '@/lib/api-client';
import {
  Sparkles,
  Zap,
  CreditCard,
  Activity,
  Layers,
  FileText,
  Info,
  CheckCircle2,
  AlertTriangle,
  ArrowRight
} from 'lucide-react';

type Health = { stalePendingCount: number; successfulLast24h: number };

function KpiDotsPattern() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" className="admin-kpi-dots" aria-hidden="true">
      <circle cx="4" cy="4" r="1.5" fill="#4ADE80" />
      <circle cx="16" cy="4" r="1.5" fill="#4ADE80" />
      <circle cx="28" cy="4" r="1.5" fill="#4ADE80" />
      <circle cx="4" cy="16" r="1.5" fill="#4ADE80" />
      <circle cx="16" cy="16" r="1.5" fill="#4ADE80" />
      <circle cx="28" cy="16" r="1.5" fill="#4ADE80" />
      <circle cx="4" cy="28" r="1.5" fill="#4ADE80" />
      <circle cx="16" cy="28" r="1.5" fill="#4ADE80" />
      <circle cx="28" cy="28" r="1.5" fill="#4ADE80" />
    </svg>
  );
}

export default function AdminOverviewPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [plansCount, setPlansCount] = useState<number | null>(null);
  const [postsCount, setPostsCount] = useState<number | null>(null);

  useEffect(() => {
    apiJson<Health>('/api/admin/webhooks/health').then(setHealth).catch(() => {});
    apiJson<any[]>('/api/plans').then((p) => setPlansCount(p.length)).catch(() => {});
    apiJson<any[]>('/api/predictions').then((posts) => setPostsCount(posts.length)).catch(() => {});
  }, []);

  return (
    <div className="admin-overview-shell">
      <div className="admin-dash-wrap">
        {/* Section Header */}
        <header className="admin-dash-header">
          <div className="admin-dash-supertitle">Admin Portal Live Console</div>
          <h1 className="admin-dash-title">System Overview</h1>
          <div className="admin-dash-underline" />
        </header>

        {/* Action Buttons */}
        <div className="admin-dash-actions">
          <Link href="/admin/predictions" className="admin-action-btn-primary">
            <div className="admin-btn-left">
              <div className="admin-btn-icon-box-dark">
                <Sparkles size={18} />
              </div>
              <span>New Prediction</span>
            </div>
            <ArrowRight size={18} />
          </Link>

          <Link href="/admin/plans" className="admin-action-btn-secondary">
            <div className="admin-btn-left">
              <div className="admin-btn-icon-box-gold">
                <Zap size={18} />
              </div>
              <span>Manage Plans</span>
            </div>
            <ArrowRight size={18} className="text-[#85a694]" />
          </Link>
        </div>

        {/* KPI Cards Stack */}
        <div className="admin-dash-cards">
          {/* Card 1: 24h Transactions */}
          <div className="admin-kpi-card">
            <div className="admin-kpi-icon-box">
              <CreditCard size={24} className="text-[#f5b335]" />
            </div>

            <div className="admin-kpi-content">
              <div className="admin-kpi-top">
                <div className="admin-kpi-label-group">
                  <span>24h Transactions</span>
                  <Info size={15} className="admin-kpi-info-icon" />
                </div>
                <span className="admin-kpi-badge">24h</span>
              </div>

              <div className="admin-kpi-value">
                {health ? health.successfulLast24h : '0'}
              </div>

              <div className="admin-kpi-status-ok">
                <CheckCircle2 size={16} className="text-[#4ade80]" />
                <span>Successful checkouts</span>
              </div>
            </div>

            <KpiDotsPattern />
          </div>

          {/* Card 2: Pending Webhooks */}
          <div className="admin-kpi-card">
            <div className="admin-kpi-icon-box admin-kpi-icon-box-emerald">
              <Activity size={24} className="text-[#4ade80]" />
            </div>

            <div className="admin-kpi-content">
              <div className="admin-kpi-top">
                <div className="admin-kpi-label-group">
                  <span>Pending Webhooks</span>
                  <Info size={15} className="admin-kpi-info-icon" />
                </div>
                <span className="admin-kpi-badge">Live</span>
              </div>

              <div className="admin-kpi-value">
                {health ? health.stalePendingCount : '0'}
              </div>

              {health && health.stalePendingCount > 0 ? (
                <div className="admin-kpi-status-alert">
                  <AlertTriangle size={16} />
                  <span>{health.stalePendingCount} stale pending (&gt;30m)</span>
                </div>
              ) : (
                <div className="admin-kpi-status-ok">
                  <CheckCircle2 size={16} className="text-[#4ade80]" />
                  <span>All gateways operational</span>
                </div>
              )}
            </div>

            <KpiDotsPattern />
          </div>

          {/* Card 3: Active Plans */}
          <div className="admin-kpi-card">
            <div className="admin-kpi-icon-box">
              <Layers size={24} className="text-[#f5b335]" />
            </div>

            <div className="admin-kpi-content">
              <div className="admin-kpi-top">
                <div className="admin-kpi-label-group">
                  <span>Active Plans</span>
                  <Info size={15} className="admin-kpi-info-icon" />
                </div>
                <span className="admin-kpi-badge">Active</span>
              </div>

              <div className="admin-kpi-value">
                {plansCount !== null ? plansCount : '1'}
              </div>

              <Link href="/admin/plans" className="admin-kpi-link">
                <span>Manage pricing</span>
                <ArrowRight size={14} />
              </Link>
            </div>

            <KpiDotsPattern />
          </div>

          {/* Card 4: Tip Feeds */}
          <div className="admin-kpi-card">
            <div className="admin-kpi-icon-box">
              <FileText size={24} className="text-[#f5b335]" />
            </div>

            <div className="admin-kpi-content">
              <div className="admin-kpi-top">
                <div className="admin-kpi-label-group">
                  <span>Tip Feeds</span>
                  <Info size={15} className="admin-kpi-info-icon" />
                </div>
                <span className="admin-kpi-badge">All</span>
              </div>

              <div className="admin-kpi-value">
                {postsCount !== null ? postsCount : '0'}
              </div>

              <Link href="/admin/predictions" className="admin-kpi-link">
                <span>View match posts</span>
                <ArrowRight size={14} />
              </Link>
            </div>

            <KpiDotsPattern />
          </div>
        </div>
      </div>
    </div>
  );
}
