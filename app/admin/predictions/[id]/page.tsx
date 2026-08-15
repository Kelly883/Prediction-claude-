'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiJson, apiFetch } from '@/lib/api-client';
import { 
  ArrowLeft, 
  Save, 
  Upload, 
  Archive, 
  CheckCircle2, 
  Sparkles, 
  Image as ImageIcon, 
  Trash2,
  AlertTriangle,
  ShieldAlert
} from 'lucide-react';

type Item = { id: string; match: string; prediction: string };
type MediaAsset = { id: string; storageKey: string };
type Post = {
  id: string;
  title: string;
  bookingCode: string;
  bodyNotes: string | null;
  status: string;
  visibility: 'plan_specific' | 'subscribers' | 'free_window';
  freeUntil: string | null;
  items: Item[];
  media: MediaAsset[];
};

const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024; // Strict 5 MB limit
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/jpg'];

export default function EditPredictionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [post, setPost] = useState<Post | null>(null);
  const [title, setTitle] = useState('');
  const [bookingCode, setBookingCode] = useState('');
  const [bodyNotes, setBodyNotes] = useState('');
  const [visibility, setVisibility] = useState<'plan_specific' | 'subscribers' | 'free_window'>('subscribers');
  const [freeUntil, setFreeUntil] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingMediaId, setDeletingMediaId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiJson<Post>(`/api/predictions/${id}`)
      .then((p) => {
        setPost(p);
        setTitle(p.title);
        setBookingCode(p.bookingCode);
        setBodyNotes(p.bodyNotes ?? '');
        setVisibility(p.visibility);
        setFreeUntil(p.freeUntil ? p.freeUntil.slice(0, 16) : '');
      })
      .finally(() => setLoading(false));
  }
  useEffect(load, [id]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await apiJson(`/api/admin/predictions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          bookingCode,
          bodyNotes,
          visibility,
          freeUntil: visibility === 'free_window' && freeUntil ? new Date(freeUntil).toISOString() : null,
        }),
      });
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!confirm('Archive this post? It will no longer appear in the feed.')) return;
    await apiJson(`/api/admin/predictions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'archived' }),
    });
    router.push('/admin/predictions');
  }

  async function publish() {
    await apiJson(`/api/admin/predictions/${id}/publish`, { method: 'POST' });
    load();
  }

  async function uploadImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !post) return;

    setError(null);

    // Client-side security validations
    if (!ALLOWED_MIME_TYPES.includes(file.type.toLowerCase())) {
      setError(`"${file.name}" is not a supported format. Only JPG and PNG images are allowed.`);
      e.target.value = '';
      return;
    }
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      setError(`"${file.name}" exceeds the maximum allowed file size of 5 MB.`);
      e.target.value = '';
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await apiFetch(`/api/admin/predictions/${post.id}/images`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Upload failed');
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function deleteImage(mediaId: string) {
    if (!post) return;
    if (!confirm('Are you sure you want to delete this prediction slip screenshot?')) return;

    setDeletingMediaId(mediaId);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/predictions/${post.id}/images/${mediaId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to delete image');
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingMediaId(null);
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-center text-sm text-[var(--chalk-muted)]">
        Loading prediction post…
      </div>
    );
  }

  if (!post) {
    return (
      <div className="p-8 text-center border border-dashed border-[rgba(243,245,236,0.14)] rounded-lg">
        <AlertTriangle size={28} className="mx-auto mb-2 text-red-400" />
        <p className="text-sm text-white font-medium">Post not found</p>
        <Link href="/admin/predictions" className="btn btn-ghost text-xs mt-3 inline-flex items-center gap-1.5">
          <ArrowLeft size={13} />
          <span>Back to predictions</span>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-[rgba(243,245,236,0.1)]">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/predictions"
            className="p-2 rounded-lg bg-[var(--turf)] text-[var(--chalk-muted)] hover:text-white border border-[rgba(243,245,236,0.1)] transition-colors"
            title="Back"
          >
            <ArrowLeft size={16} />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-xl sm:text-2xl text-white truncate max-w-md">
                Edit Post
              </h1>
              <span
                className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded ${
                  post.status === 'published'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                }`}
              >
                {post.status}
              </span>
            </div>
            <p className="text-xs text-[var(--chalk-muted)] font-mono mt-0.5">
              ID: {post.id}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {post.status !== 'published' && (
            <button
              onClick={publish}
              className="btn btn-ghost text-xs py-2 px-3 inline-flex items-center gap-1.5 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
            >
              <CheckCircle2 size={14} />
              <span>Publish Live</span>
            </button>
          )}
          <button
            onClick={archive}
            className="btn btn-ghost text-xs py-2 px-3 inline-flex items-center gap-1.5 text-red-400 border-red-500/30 hover:bg-red-500/10"
          >
            <Archive size={14} />
            <span>Archive</span>
          </button>
        </div>
      </div>

      <div className="admin-grid-2col">
        {/* Post Form */}
        <div className="card p-4 sm:p-5 space-y-4">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Sparkles size={16} className="text-[var(--floodlight)]" />
            <span>Post Details</span>
          </h2>

          <div className="field mb-0">
            <label htmlFor="title" className="text-xs text-[var(--chalk-muted)] font-medium">Title</label>
            <input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full text-sm"
            />
          </div>

          <div className="field mb-0">
            <label htmlFor="bookingCode" className="text-xs text-[var(--chalk-muted)] font-medium">Betting Booking Code</label>
            <input
              id="bookingCode"
              value={bookingCode}
              onChange={(e) => setBookingCode(e.target.value)}
              className="w-full font-mono uppercase text-sm"
            />
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

          {visibility === 'free_window' && (
            <div className="field mb-0">
              <label htmlFor="freeUntil" className="text-xs text-[var(--chalk-muted)] font-medium">Free Access Until</label>
              <input
                id="freeUntil"
                type="datetime-local"
                value={freeUntil}
                onChange={(e) => setFreeUntil(e.target.value)}
                className="w-full text-sm"
              />
            </div>
          )}

          <div className="field mb-0">
            <label htmlFor="bodyNotes" className="text-xs text-[var(--chalk-muted)] font-medium">Analyst Notes & Insights</label>
            <textarea
              id="bodyNotes"
              rows={4}
              value={bodyNotes}
              onChange={(e) => setBodyNotes(e.target.value)}
              placeholder="Add match preview commentary, weather updates, or accumulator tips…"
              className="w-full bg-[var(--pitch)] border border-[rgba(243,245,236,0.14)] rounded-lg p-3 text-sm text-[var(--chalk)] font-sans focus:border-[var(--floodlight)] outline-none"
            />
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
              <ShieldAlert size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="pt-2">
            <button
              onClick={save}
              className="btn btn-primary w-full py-2.5 text-sm font-semibold flex items-center justify-center gap-2"
              disabled={saving}
            >
              <Save size={14} />
              <span>{saving ? 'Saving Changes…' : 'Save Changes'}</span>
            </button>
          </div>

          {/* Matches Summary */}
          <div className="pt-4 border-t border-[rgba(243,245,236,0.08)]">
            <h3 className="text-xs font-semibold text-white uppercase tracking-wider font-mono mb-2">
              Attached Match Picks ({(post.items ?? []).length})
            </h3>
            <div className="space-y-1.5">
              {(post.items ?? []).map((item) => (
                <div
                  key={item.id}
                  className="p-2.5 rounded bg-[var(--pitch)] border border-[rgba(243,245,236,0.06)] flex items-center justify-between text-xs gap-2"
                >
                  <span className="text-white font-medium truncate">{item.match}</span>
                  <span className="mono text-[var(--floodlight)] font-semibold shrink-0">
                    {item.prediction}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Media & Images Management */}
        <div className="card p-4 sm:p-5 space-y-4">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <ImageIcon size={16} className="text-[var(--floodlight)]" />
            <span>Slip Screenshots & Media ({(post.media ?? []).length})</span>
          </h2>

          <div className="p-4 rounded-lg bg-[var(--pitch)] border border-dashed border-[rgba(243,245,236,0.18)] text-center space-y-2">
            <Upload size={24} className="mx-auto text-[var(--chalk-muted)]" />
            <div className="text-xs text-[var(--chalk-muted)]">
              Upload betslip screenshots (JPEG, PNG up to 5MB)
            </div>
            <label className="btn btn-ghost text-xs py-1.5 px-3 cursor-pointer inline-flex items-center gap-1.5 border-[rgba(243,245,236,0.15)]">
              <span>Choose Image File</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/jpg"
                onChange={uploadImage}
                disabled={uploading}
                className="hidden"
              />
            </label>
            {uploading && <p className="text-xs text-[var(--floodlight)] font-mono animate-pulse">Processing & uploading asset…</p>}
          </div>

          <div className="space-y-2.5">
            {(post.media ?? []).length === 0 ? (
              <p className="text-xs text-[var(--chalk-muted)] text-center py-4">
                No screenshot media uploaded for this tip.
              </p>
            ) : (
              (post.media ?? []).map((m) => (
                <div
                  key={m.id}
                  className="p-3 rounded-lg bg-[var(--pitch)] border border-[rgba(243,245,236,0.08)] flex items-center justify-between text-xs gap-3"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
                      <ImageIcon size={14} className="text-[var(--floodlight)]" />
                    </div>
                    <div className="min-w-0">
                      <div className="mono text-white truncate text-xs font-medium">
                        {m.storageKey.split('/').pop()}
                      </div>
                      <div className="text-[10px] text-emerald-400 font-mono">Sanitized & Encrypted</div>
                    </div>
                  </div>

                  <button
                    onClick={() => deleteImage(m.id)}
                    disabled={deletingMediaId === m.id}
                    className="p-1.5 rounded text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                    title="Delete image"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
