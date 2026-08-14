'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
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
    <div className="admin-kpi-dots" aria-hidden="true">
      <svg width="60" height="48" viewBox="0 0 60 48" fill="none">
        {Array.from({ length: 5 }).map((_, r) =>
          Array.from({ length: 6 }).map((_, c) => (
            <circle
              key={`${r}-${c}`}
              cx={c * 10 + 4}
              cy={r * 10 + 4}
              r="1.4"
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
    async function load() {
      try {
        const [hRes, pRes, postRes, uRes] = await Promise.all([
          fetch('/api/admin/health'),
          fetch('/api/plans'),
          fetch('/api/posts'),
          fetch('/api/admin/users?limit=1')
        ]);
        if (hRes.ok) setHealth(await hRes.json());
        const pData = pRes.ok ? await pRes.json() : [];
        const postData = postRes.ok ? await postRes.json() : [];
        const uData = uRes.ok ? await uRes.json() : { total: 0 };
        setCounts({
          plans: Array.isArray(pData) ? pData.length : 0,
          posts: Array.isArray(postData) ? postData.length : 0,
          users: uData.total ?? 0
        });
      } catch (err) {
        console.error('Failed to load stats:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="admin-dash-wrap">
      {/* Title & Supertitle Header */}
      <header className="admin-dash-header">
        <div className="admin-dash-supertitle">
          Admin Portal Live Console
        </div>
        <h1 className="admin-dash-title">
          System Overview
        </h1>
        <div className="admin-dash-underline" />
      </header>

      {/* Action Buttons Row */}
      <div className="admin-dash-actions">
        <Link
          href="/admin/predictions"
          className="admin-action-btn-primary"
        >
          <div className="admin-btn-left">
            <div className="admin-btn-icon-box-dark">
              <Sparkles size={16} />
            </div>
            <span>New Prediction</span>
          </div>
          <ArrowRight size={18} />
        </Link>

        <Link
          href="/admin/plans"
          className="admin-action-btn-secondary"
        >
          <div className="admin-btn-left">
            <div className="admin-btn-icon-box-gold">
              <Zap size={16} />
            </div>
            <span>Manage Plans</span>
          </div>
          <ArrowRight size={18} />
        </Link>
      </div>

      {/* Metric Cards Stack */}
      <div className="admin-dash-cards">
        {/* Card 1: 24h Transactions */}
        <div className="admin-kpi-card">
          <DotGridDecoration />
          <div className="admin-kpi-icon-box">
            <CreditCard size={22} color="#f5b335" />
          </div>
          <div className="admin-kpi-content">
            <div className="admin-kpi-top">
              <div className="admin-kpi-label-group">
                <span>24h Transactions</span>
                <Info size={15} className="admin-kpi-info-icon" />
              </div>
              <span className="admin-kpi-badge">
                24h
              </span>
            </div>
            <div className="admin-kpi-value">
              {loading ? '—' : health?.successfulLast24h ?? 0}
            </div>
            <div className="admin-kpi-status-ok">
              <CheckCircle2 size={16} color="#4ade80" />
              <span>Successful checkouts</span>
            </div>
          </div>
        </div>

        {/* Card 2: Pending Webhooks */}
        <div className="admin-kpi-card">
          <DotGridDecoration />
          <div className="admin-kpi-icon-box admin-kpi-icon-box-emerald">
            <Activity size={22} color="#4ade80" />
          </div>
          <div className="admin-kpi-content">
            <div className="admin-kpi-top">
              <div className="admin-kpi-label-group">
                <span>Pending Webhooks</span>
                <Info size={15} className="admin-kpi-info-icon" />
              </div>
              <span className="admin-kpi-badge">
                Live
              </span>
            </div>
            <div 
              className="admin-kpi-value"
              style={{ color: (health?.stalePendingCount ?? 0) > 0 ? 'var(--card-red)' : '#ffffff' }}
            >
              {loading ? '—' : health?.stalePendingCount ?? 0}
            </div>
            {(health?.stalePendingCount ?? 0) > 0 ? (
              <div className="admin-kpi-status-alert">
                <AlertTriangle size={16} color="var(--card-red)" />
                <span>Requires webhook check</span>
              </div>
            ) : (
              <div className="admin-kpi-status-ok">
                <CheckCircle2 size={16} color="#4ade80" />
                <span>All gateways operational</span>
              </div>
            )}
          </div>
        </div>

        {/* Card 3: Active Plans */}
        <div className="admin-kpi-card">
          <DotGridDecoration />
          <div className="admin-kpi-icon-box">
            <Layers size={22} color="#f5b335" />
          </div>
          <div className="admin-kpi-content">
            <div className="admin-kpi-top">
              <div className="admin-kpi-label-group">
                <span>Active Plans</span>
                <Info size={15} className="admin-kpi-info-icon" />
              </div>
              <span className="admin-kpi-badge">
                Active
              </span>
            </div>
            <div className="admin-kpi-value">
              {loading ? '—' : counts?.plans ?? 0}
            </div>
            <div>
              <Link 
                href="/admin/plans" 
                className="admin-kpi-link"
              >
                <span>Manage pricing</span>
                <ArrowRight size={13} />
              </Link>
            </div>
          </div>
        </div>

        {/* Card 4: Tip Feeds */}
        <div className="admin-kpi-card">
          <DotGridDecoration />
          <div className="admin-kpi-icon-box">
            <FileText size={22} color="#f5b335" />
          </div>
          <div className="admin-kpi-content">
            <div className="admin-kpi-top">
              <div className="admin-kpi-label-group">
                <span>Tip Feeds</span>
                <Info size={15} className="admin-kpi-info-icon" />
              </div>
              <span className="admin-kpi-badge">
                All
              </span>
            </div>
            <div className="admin-kpi-value">
              {loading ? '—' : counts?.posts ?? 0}
            </div>
            <div>
              <Link 
                href="/admin/predictions" 
                className="admin-kpi-link"
              >
                <span>View match posts</span>
                <ArrowRight size={13} />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
