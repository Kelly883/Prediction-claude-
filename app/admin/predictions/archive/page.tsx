'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiJson } from '@/lib/api-client';
import { useHasPermission } from '@/lib/use-permissions';
import { PERMISSIONS } from '@/lib/permissions';
import {
  ArrowLeft,
  Edit,
  Calendar,
  Image as ImageIcon,
  Trophy,
  XCircle,
} from 'lucide-react';

type MediaAsset = { id: string; storageKey: string };
type PostItem = { id?: string; match: string; prediction: string };
type SubscriptionPlan = {
  id: string;
  name: string;
  durationDays: number;
  priceNGN: string;
  priceUSDOverride: string | null;
  isActive: boolean;
};
type Post = {
  id: string;
  title: string;
  status: string;
  outcome: string;
  scheduledAt: string;
  bookingCode: string;
  visibility: 'plan_specific' | 'subscribers' | 'free_window';
  planIds?: string[];
  items?: PostItem[];
  media?: MediaAsset[];
};

export default function AdminArchivePage() {
  const canManagePredictions = useHasPermission(PERMISSIONS.pages.predictions);

  const [posts, setPosts] = useState<Post[]>([]);
  const [availablePlans, setAvailablePlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    apiJson<Post[]>('/api/admin/predictions/archive')
      .then(setPosts)
      .finally(() => setLoading(false));
    apiJson<SubscriptionPlan[]>('/api/plans')
      .then(setAvailablePlans)
      .catch(() => {});
  }

  useEffect(load, []);

  const outcomeLabel = (outcome: string) => {
    if (outcome === 'won') return { text: 'Won', className: 'admin-status-pill-success' };
    if (outcome === 'lost') return { text: 'Lost', className: 'admin-status-pill-error' };
    return { text: outcome, className: 'admin-status-pill-warning' };
  };

  return (
    <div className="admin-dash-wrap">
      <div className="admin-page-header">
        <div className="admin-page-eyebrow">Archive</div>
        <h1 className="admin-page-title">Prediction Archive</h1>
        <p className="admin-page-subtitle">Completed predictions marked as won or lost.</p>
        <div className="admin-underline" />
      </div>

      {loading ? (
        <div className="admin-loading animate-pulse">Loading archive…</div>
      ) : posts.length === 0 ? (
        <div className="admin-empty-state">
          <div className="admin-empty-state-icon" style={{ width: 64, height: 64 }}>
            <svg width="64" height="64" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="25" y="20" width="50" height="68" rx="8" stroke="#10b981" strokeWidth="2.5" fill="#0c2317" />
              <path d="M40 20V15C40 13.3431 41.3431 12 43 12H57C58.6569 12 60 13.3431 60 15V20" stroke="#10b981" strokeWidth="2.5" />
              <path d="M36 36L46 46M46 36L36 46" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" />
              <circle cx="62" cy="58" r="5" stroke="#10b981" strokeWidth="2.5" />
              <path d="M38 60L46 54" stroke="#10b981" strokeWidth="2" strokeDasharray="2 2" />
              <circle cx="68" cy="72" r="14" fill="#081910" stroke="#10b981" strokeWidth="2.5" />
              <circle cx="68" cy="72" r="5" fill="#10b981" />
            </svg>
          </div>
          <div style={{ maxWidth: 420, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p className="admin-empty-state-title">No archived predictions yet.</p>
            <p className="admin-empty-state-desc">Mark predictions as won or lost from the edit page to move them here.</p>
          </div>
        </div>
      ) : (
        <div className="admin-compose-card">
          <div className="flex flex-col gap-3">
            {posts.map((p) => {
              const outcome = outcomeLabel(p.outcome);
              return (
                <div
                  key={p.id}
                  className="admin-post-card group"
                >
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="admin-post-card-title group-hover:text-[#f5b335]">{p.title}</span>
                      <span className={`admin-tag ${outcome.className}`}>{outcome.text}</span>
                      {p.media && p.media.length > 0 && (
                        <span className="admin-tag admin-tag-purple">
                          <ImageIcon size={11} />
                          <span>{p.media.length} slip image{p.media.length > 1 ? 's' : ''}</span>
                        </span>
                      )}
                      <span className="admin-tag-mono">
                        {p.visibility === 'subscribers'
                          ? p.planIds && p.planIds.length > 0
                            ? `Plans: ${p.planIds.map((id) => availablePlans.find((ap) => ap.id === id)?.name || id).join(', ')}`
                            : 'All Active Subscribers'
                          : p.visibility === 'plan_specific'
                            ? p.planIds && p.planIds.length > 0
                              ? `Plans: ${p.planIds.map((id) => availablePlans.find((ap) => ap.id === id)?.name || id).join(', ')}`
                              : 'VIP Plan Only'
                            : 'Free Window'}
                      </span>
                    </div>
                    <div className="admin-post-card-meta">
                      <span className="inline-flex items-center gap-1.5">
                        <Calendar size={13} style={{ color: '#f5b335' }} />
                        {new Date(p.scheduledAt).toLocaleString()}
                      </span>
                      <span style={{ color: '#9fb3a6' }}>•</span>
                      <span style={{ color: '#f5b335', fontWeight: 700 }}>Booking Code: {p.bookingCode}</span>
                    </div>
                    {p.items && p.items.length > 0 && (
                      <div className="flex flex-col gap-1.5 mt-1">
                        {p.items.map((item, idx) => (
                          <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 0', borderBottom: '1px solid rgba(243,245,236,0.06)' }}>
                            <span style={{ color: 'var(--chalk)', fontWeight: 500 }}>{item.match}</span>
                            <span style={{ color: 'var(--floodlight)', fontWeight: 700, fontFamily: 'var(--font-mono), monospace' }}>{item.prediction}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="admin-post-card-actions">
                    <Link
                      href={`/admin/predictions/${p.id}`}
                      className="admin-back-btn"
                      style={{ padding: '8px 12px', fontSize: 12 }}
                    >
                      <Edit size={13} />
                      <span>Edit Post</span>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
