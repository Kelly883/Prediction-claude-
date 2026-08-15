'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiJson } from '@/lib/api-client';
import {
  Upload,
  Plus,
  ChevronRight,
  Sparkles,
  Trash2,
  Edit,
  CheckCircle2,
  Calendar
} from 'lucide-react';

type Post = { id: string; title: string; status: string; scheduledAt: string; bookingCode: string };

const emptyItem = () => ({ match: '', prediction: '' });

function TacticsBoardIllustration() {
  return (
    <div className="admin-tactics-illustration" aria-hidden="true">
      {/* Sparkles / Gold Stars */}
      <svg className="absolute -top-1 left-2 w-4 h-4 text-[#f5b335]" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2l2.4 7.2h7.6l-6 4.8 2.4 7.2-6-4.8-6 4.8 2.4-7.2-6-4.8h7.6z" />
      </svg>
      <svg className="absolute top-1 right-2 w-5 h-5 text-[#f5b335]" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2l2.4 7.2h7.6l-6 4.8 2.4 7.2-6-4.8-6 4.8 2.4-7.2-6-4.8h7.6z" />
      </svg>
      <svg className="absolute bottom-1 left-3 w-4 h-4 text-[#f5b335]" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2l2.4 7.2h7.6l-6 4.8 2.4 7.2-6-4.8-6 4.8 2.4-7.2-6-4.8h7.6z" />
      </svg>

      {/* Clipboard Icon */}
      <svg width="68" height="68" viewBox="0 0 64 64" fill="none">
        {/* Clipboard board */}
        <rect x="14" y="12" width="36" height="46" rx="6" stroke="#4ade80" strokeWidth="3" fill="#102e20" />
        {/* Clip top */}
        <path d="M24 12V8C24 6.89543 24.8954 6 26 6H38C39.1046 6 40 6.89543 40 8V12" stroke="#4ade80" strokeWidth="3" fill="#102e20" />
        {/* Tactics X's and O's & Arrows */}
        <path d="M22 24L28 30M28 24L22 30" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M38 38L44 44M44 38L38 44" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M24 38D" stroke="#4ade80" strokeWidth="2.5" />
        <path d="M28 32C32 26 36 28 40 24" stroke="#4ade80" strokeWidth="2.5" strokeDasharray="3 3" strokeLinecap="round" />
        <path d="M37 23L41 24L40 28" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      {/* Ball Emblem at Bottom Right */}
      <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-[#102e20] border-2 border-[#4ade80] flex items-center justify-center text-[#4ade80]">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 7l3 2v3l-3 2-3-2V9z" fill="currentColor" fillOpacity="0.2" />
        </svg>
      </div>
    </div>
  );
}

export default function AdminPredictionsPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [bookingCode, setBookingCode] = useState('');
  const [visibility, setVisibility] = useState<'plan_specific' | 'subscribers' | 'free_window'>('subscribers');
  const [items, setItems] = useState([emptyItem()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    apiJson<Post[]>('/api/predictions').then(setPosts).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function createPost(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiJson('/api/admin/predictions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          scheduledAt: new Date(scheduledAt).toISOString(),
          bookingCode,
          visibility,
          items: items.filter((i) => i.match && i.prediction),
        }),
      });
      setTitle(''); setScheduledAt(''); setBookingCode(''); setItems([emptyItem()]); setShowForm(false);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function publish(id: string) {
    await apiJson(`/api/admin/predictions/${id}/publish`, { method: 'POST' });
    load();
  }

  return (
    <div className="admin-predictions-wrap">
      {/* Header */}
      <header className="admin-predictions-header">
        <h1 className="admin-predictions-title">Predictions & Match Tips</h1>
        <p className="admin-predictions-subtitle">
          Publish match slips, booking codes, and scheduled betting insights.
        </p>
      </header>

      {/* Action Cards Grid */}
      <div className="admin-predictions-actions">
        <Link href="/admin/predictions/csv" className="admin-action-card-csv">
          <div className="admin-btn-left">
            <div className="admin-card-icon-box-emerald">
              <Upload size={20} />
            </div>
            <div className="admin-card-text-col">
              <span className="admin-card-text-title">Import CSV</span>
              <span className="admin-card-text-sub">Bulk upload tips</span>
            </div>
          </div>
          <ChevronRight size={20} className="text-[#85a694]" />
        </Link>

        <button
          onClick={() => setShowForm((s) => !s)}
          className="admin-action-card-new"
        >
          <div className="admin-btn-left">
            <div className="admin-card-icon-box-dark">
              <Plus size={20} />
            </div>
            <div className="admin-card-text-col text-left">
              <span className="admin-card-text-title">
                {showForm ? 'Close Form' : 'New Tip Post'}
              </span>
              <span className="admin-card-text-sub">
                {showForm ? 'Cancel composing' : 'Create manually'}
              </span>
            </div>
          </div>
          <ChevronRight size={20} className="text-[#0a2116]" />
        </button>
      </div>

      {/* Compose Form */}
      {showForm && (
        <form onSubmit={createPost} className="admin-plan-form-card">
          <h2 className="admin-plan-form-title">
            <Sparkles size={20} className="text-[#f5b335]" />
            <span>Compose Matchday Post</span>
          </h2>

          <div className="admin-form-group">
            <label htmlFor="title" className="admin-form-label">Post Title</label>
            <input
              id="title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Saturday European Big 5 Banker"
              className="admin-text-input"
            />
          </div>

          <div className="admin-form-row-2col">
            <div className="admin-form-group">
              <label htmlFor="scheduledAt" className="admin-form-label">Scheduled Match Time</label>
              <input
                id="scheduledAt"
                type="datetime-local"
                required
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="admin-text-input"
              />
            </div>
            <div className="admin-form-group">
              <label htmlFor="bookingCode" className="admin-form-label">Betting Booking Code</label>
              <input
                id="bookingCode"
                required
                value={bookingCode}
                onChange={(e) => setBookingCode(e.target.value)}
                placeholder="e.g. BC-98342 or SportyBet code"
                className="admin-text-input font-mono uppercase"
              />
            </div>
          </div>

          <div className="admin-form-group">
            <label htmlFor="visibility" className="admin-form-label">Subscriber Visibility</label>
            <select
              id="visibility"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as any)}
              className="admin-text-input"
            >
              <option value="subscribers">All subscribers</option>
              <option value="plan_specific">Specific plans</option>
              <option value="free_window">Free window</option>
            </select>
          </div>

          {/* Dynamic Match Items */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-white uppercase tracking-wider font-mono">
                Individual Match Predictions ({items.length})
              </label>
              <button
                type="button"
                onClick={() => setItems([...items, emptyItem()])}
                className="text-xs text-[#f5b335] hover:underline inline-flex items-center gap-1 font-semibold"
              >
                <Plus size={14} />
                <span>Add Another Match</span>
              </button>
            </div>

            {items.map((item, i) => (
              <div
                key={i}
                className="p-3 rounded-xl bg-[#0b2216] border border-[rgba(243,245,236,0.08)] flex flex-col sm:flex-row gap-2 items-stretch sm:items-center"
              >
                <div className="flex-1">
                  <input
                    placeholder="Teams (e.g. Arsenal vs Chelsea)"
                    value={item.match}
                    onChange={(e) => setItems(items.map((it, idx) => (idx === i ? { ...it, match: e.target.value } : it)))}
                    className="w-full text-xs sm:text-sm bg-transparent border-0 p-1 text-white focus:ring-0 outline-none"
                  />
                </div>
                <div className="sm:w-48 border-t sm:border-t-0 sm:border-l border-[rgba(243,245,236,0.1)] pt-2 sm:pt-0 sm:pl-2">
                  <input
                    placeholder="Pick (e.g. Over 2.5 @ 1.85)"
                    value={item.prediction}
                    onChange={(e) => setItems(items.map((it, idx) => (idx === i ? { ...it, prediction: e.target.value } : it)))}
                    className="w-full text-xs sm:text-sm bg-transparent border-0 p-1 text-[#f5b335] font-mono focus:ring-0 outline-none"
                  />
                </div>
                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setItems(items.filter((_, idx) => idx !== i))}
                    className="self-end sm:self-center p-1.5 text-zinc-400 hover:text-red-400"
                    title="Remove match"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {error && <div className="text-xs text-red-400 p-2 rounded bg-red-500/10 border border-red-500/20">{error}</div>}

          <div className="flex items-center gap-3 pt-2">
            <button type="submit" disabled={saving} className="admin-submit-btn flex-1">
              {saving ? 'Saving…' : 'Save as Draft'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="admin-cancel-btn w-auto px-6">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Feed Archive Section */}
      {loading ? (
        <div className="admin-predictions-feed-container">
          <p className="text-sm text-[#85a694]">Loading match predictions…</p>
        </div>
      ) : posts.length === 0 ? (
        <div className="admin-predictions-feed-container">
          <TacticsBoardIllustration />

          <div className="admin-feed-heading-group">
            <h2 className="admin-feed-heading">
              Feed Archive ({posts.length}) • Live Tips Repository
            </h2>
            <div className="admin-feed-accent-bar" />
          </div>

          <p className="admin-feed-empty-title">
            No match predictions created yet.
          </p>

          <p className="admin-feed-empty-desc">
            Click &quot;New Tip Post&quot; or import a CSV slip to publish your first match predictions.
          </p>
        </div>
      ) : (
        <div className="admin-plan-card">
          <div className="flex items-center justify-between pb-3 border-b border-[rgba(243,245,236,0.1)]">
            <h2 className="text-lg font-bold text-white">
              Feed Archive ({posts.length}) • Live Tips Repository
            </h2>
            <span className="text-xs text-[#85a694] font-mono">
              {posts.length} {posts.length === 1 ? 'post' : 'posts'}
            </span>
          </div>

          <div className="space-y-3 pt-2">
            {posts.map((p) => (
              <div
                key={p.id}
                className="p-4 rounded-xl bg-[#0b2216] border border-[rgba(243,245,236,0.1)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
              >
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-base text-white">{p.title}</span>
                    <span
                      className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded ${
                        p.status === 'published'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      }`}
                    >
                      {p.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-[#85a694] mt-1.5 flex-wrap font-mono">
                    <span className="flex items-center gap-1">
                      <Calendar size={12} />
                      {new Date(p.scheduledAt).toLocaleString()}
                    </span>
                    <span>•</span>
                    <span className="text-[#f5b335]">Code: {p.bookingCode}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center">
                  <Link
                    href={`/admin/predictions/${p.id}`}
                    className="btn btn-ghost text-xs py-1.5 px-3 inline-flex items-center gap-1"
                  >
                    <Edit size={12} />
                    <span>Edit</span>
                  </Link>
                  {p.status !== 'published' && (
                    <button
                      onClick={() => publish(p.id)}
                      className="btn btn-primary text-xs py-1.5 px-3 inline-flex items-center gap-1"
                    >
                      <CheckCircle2 size={12} />
                      <span>Publish</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
