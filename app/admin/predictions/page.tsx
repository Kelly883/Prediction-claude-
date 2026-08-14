'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiJson } from '@/lib/api-client';
import { Sparkles, Plus, Upload, Trash2, Edit, CheckCircle2, Calendar, Lock } from 'lucide-react';

type Post = { id: string; title: string; status: string; scheduledAt: string; bookingCode: string };

const emptyItem = () => ({ match: '', prediction: '' });

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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-[rgba(243,245,236,0.1)]">
        <div>
          <h1 className="font-bold text-2xl sm:text-3xl text-white">Predictions & Match Tips</h1>
          <p className="text-xs sm:text-sm text-[var(--chalk-muted)] mt-1">
            Publish match slips, booking codes, and scheduled betting insights.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/admin/predictions/csv"
            className="btn btn-ghost text-xs sm:text-sm py-2 px-3 inline-flex items-center gap-1.5"
          >
            <Upload size={14} />
            <span>Import CSV</span>
          </Link>
          <button
            onClick={() => setShowForm((s) => !s)}
            className="btn btn-primary text-xs sm:text-sm py-2 px-4 inline-flex items-center gap-1.5"
          >
            {showForm ? (
              <span>Close Form</span>
            ) : (
              <>
                <Plus size={14} />
                <span>New Tip Post</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* New Post Form */}
      {showForm && (
        <form onSubmit={createPost} className="card p-4 sm:p-6 space-y-4">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Sparkles size={16} className="text-[var(--floodlight)]" />
            <span>Compose Matchday Post</span>
          </h2>

          <div className="field mb-0">
            <label htmlFor="title" className="text-xs text-[var(--chalk-muted)] font-medium">Post Title</label>
            <input
              id="title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Saturday European Big 5 Banker"
              className="w-full"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="field mb-0">
              <label htmlFor="scheduledAt" className="text-xs text-[var(--chalk-muted)] font-medium">Scheduled Match Time</label>
              <input
                id="scheduledAt"
                type="datetime-local"
                required
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full"
              />
            </div>
            <div className="field mb-0">
              <label htmlFor="bookingCode" className="text-xs text-[var(--chalk-muted)] font-medium">Betting Booking Code</label>
              <input
                id="bookingCode"
                required
                value={bookingCode}
                onChange={(e) => setBookingCode(e.target.value)}
                placeholder="e.g. BC-98342 or SportyBet code"
                className="w-full font-mono uppercase"
              />
            </div>
          </div>

          <div className="field mb-0">
            <label htmlFor="visibility" className="text-xs text-[var(--chalk-muted)] font-medium">Subscriber Visibility</label>
            <select
              id="visibility"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as any)}
              className="w-full bg-[var(--pitch)] border border-[rgba(243,245,236,0.14)] rounded-md p-3 text-sm text-[var(--chalk)]"
            >
              <option value="subscribers">All Active Subscribers</option>
              <option value="plan_specific">Plan-Specific VIPs</option>
              <option value="free_window">Free Window (Promotional)</option>
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
                className="text-xs text-[var(--floodlight)] hover:underline inline-flex items-center gap-1"
              >
                <Plus size={12} />
                <span>Add Another Match</span>
              </button>
            </div>

            {items.map((item, i) => (
              <div
                key={i}
                className="p-3 rounded-lg bg-[var(--pitch)] border border-[rgba(243,245,236,0.08)] flex flex-col sm:flex-row gap-2 items-stretch sm:items-center"
              >
                <div className="flex-1">
                  <input
                    placeholder="Teams (e.g. Arsenal vs Chelsea)"
                    value={item.match}
                    onChange={(e) => setItems(items.map((it, idx) => (idx === i ? { ...it, match: e.target.value } : it)))}
                    className="w-full text-xs sm:text-sm bg-transparent border-0 p-1 text-white focus:ring-0"
                  />
                </div>
                <div className="sm:w-48 border-t sm:border-t-0 sm:border-l border-[rgba(243,245,236,0.1)] pt-2 sm:pt-0 sm:pl-2">
                  <input
                    placeholder="Pick (e.g. Over 2.5 @ 1.85)"
                    value={item.prediction}
                    onChange={(e) => setItems(items.map((it, idx) => (idx === i ? { ...it, prediction: e.target.value } : it)))}
                    className="w-full text-xs sm:text-sm bg-transparent border-0 p-1 text-[var(--floodlight)] font-mono focus:ring-0"
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

          {error && <div className="error-text">{error}</div>}

          <div className="flex items-center gap-3 pt-2">
            <button type="submit" className="btn btn-primary py-2.5 px-5 text-sm font-semibold" disabled={saving}>
              {saving ? 'Saving…' : 'Save as Draft'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="btn btn-ghost py-2.5 px-4 text-sm">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Predictions Feed Card */}
      <div className="card p-4 sm:p-5">
        <h2 className="text-base font-semibold text-white mb-4 flex items-center justify-between">
          <span>Feed Archive ({posts.length})</span>
          <span className="text-xs text-[var(--chalk-muted)] font-mono">Live Tips Repository</span>
        </h2>

        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--chalk-muted)]">
            Loading match posts…
          </div>
        ) : posts.length === 0 ? (
          <div className="p-8 text-center border border-dashed border-[rgba(243,245,236,0.14)] rounded-lg">
            <Sparkles size={28} className="mx-auto mb-2 text-[var(--floodlight)] opacity-80" />
            <p className="text-sm text-white font-medium">No match predictions created yet</p>
            <p className="text-xs text-[var(--chalk-muted)] mt-1 max-w-sm mx-auto">
              Click &quot;New Tip Post&quot; or import a CSV slip to publish your first match predictions.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {posts.map((p) => (
              <div
                key={p.id}
                className="p-4 rounded-lg bg-[var(--pitch)] border border-[rgba(243,245,236,0.1)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
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
                  <div className="flex items-center gap-3 text-xs text-[var(--chalk-muted)] mt-1.5 flex-wrap font-mono">
                    <span className="flex items-center gap-1">
                      <Calendar size={12} />
                      {new Date(p.scheduledAt).toLocaleString()}
                    </span>
                    <span>•</span>
                    <span className="text-[var(--floodlight)]">Code: {p.bookingCode}</span>
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
        )}
      </div>
    </div>
  );
}

