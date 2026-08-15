'use client';

import { useEffect, useState, useRef } from 'react';
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
  ShieldAlert,
  Eye,
  FileImage,
  X,
  Plus
} from 'lucide-react';

type Item = { id: string; match: string; prediction: string };
type MediaAsset = { id: string; storageKey: string };
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
  bookingCode: string;
  bodyNotes: string | null;
  status: string;
  visibility: 'plan_specific' | 'subscribers' | 'free_window';
  planIds?: string[];
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
  const [availablePlans, setAvailablePlans] = useState<SubscriptionPlan[]>([]);
  const [title, setTitle] = useState('');
  const [bookingCode, setBookingCode] = useState('');
  const [bodyNotes, setBodyNotes] = useState('');
  const [visibility, setVisibility] = useState<'plan_specific' | 'subscribers' | 'free_window'>('subscribers');
  const [planIds, setPlanIds] = useState<string[]>([]);
  const [freeUntil, setFreeUntil] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingMediaId, setDeletingMediaId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Signed URLs for viewing uploaded media images
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [previewModalUrl, setPreviewModalUrl] = useState<string | null>(null);

  // File input ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  function load() {
    apiJson<Post>(`/api/predictions/${id}`)
      .then((p) => {
        setPost(p);
        setTitle(p.title);
        setBookingCode(p.bookingCode);
        setBodyNotes(p.bodyNotes ?? '');
        setVisibility(p.visibility);
        setPlanIds(p.planIds ?? []);
        setFreeUntil(p.freeUntil ? p.freeUntil.slice(0, 16) : '');
      })
      .finally(() => setLoading(false));

    apiJson<SubscriptionPlan[]>('/api/plans')
      .then(setAvailablePlans)
      .catch(() => {});
  }

  useEffect(load, [id]);

  // Fetch signed media URLs for previews
  useEffect(() => {
    if (!post || !post.media) return;
    post.media.forEach((asset) => {
      if (mediaUrls[asset.id]) return;
      apiJson<{ url: string }>(`/api/media/${asset.id}/signed-url`)
        .then((data) => setMediaUrls((prev) => ({ ...prev, [asset.id]: data.url })))
        .catch(() => {});
    });
  }, [post]);

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
          planIds: visibility === 'plan_specific' ? planIds : [],
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
    const files = Array.from(e.target.files ?? []);
    if (!files.length || !post) return;

    setError(null);

    for (const file of files) {
      if (!ALLOWED_MIME_TYPES.includes(file.type.toLowerCase())) {
        setError(`"${file.name}" is not a supported format. Only JPG and PNG images are allowed.`);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
        setError(`"${file.name}" exceeds the maximum allowed file size of 5 MB.`);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
    }

    setUploading(true);
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        const res = await apiFetch(`/api/admin/predictions/${post.id}/images`, { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `Upload failed for ${file.name}`);
      }
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
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
      <div className="p-12 text-center text-sm text-[var(--chalk-muted)] font-mono animate-pulse">
        Loading prediction post details…
      </div>
    );
  }

  if (!post) {
    return (
      <div className="p-8 text-center border border-dashed border-[rgba(243,245,236,0.14)] rounded-xl">
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
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/admin/predictions"
            className="p-2 rounded-xl bg-[var(--turf)] text-[var(--chalk-muted)] hover:text-white border border-[rgba(243,245,236,0.1)] transition-colors shrink-0"
            title="Back to Predictions"
          >
            <ArrowLeft size={16} />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-bold text-xl sm:text-2xl text-white truncate">
                Edit Prediction Post
              </h1>
              <span
                className={`px-2.5 py-0.5 text-[10px] font-extrabold uppercase rounded-full ${
                  post.status === 'published'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                }`}
              >
                {post.status}
              </span>
            </div>
            <p className="text-xs text-[var(--chalk-muted)] font-mono mt-0.5 truncate">
              Post ID: {post.id}
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
            <span>Archive Post</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Post Form Column */}
        <div className="lg:col-span-7 space-y-6">
          <div className="card p-4 sm:p-6 space-y-4">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Sparkles size={16} className="text-[var(--floodlight)]" />
              <span>Post Configuration</span>
            </h2>

            <div className="field mb-0">
              <label htmlFor="title" className="text-xs text-[var(--chalk-muted)] font-semibold uppercase tracking-wider font-mono">
                Title
              </label>
              <input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full text-sm font-medium"
              />
            </div>

            <div className="field mb-0">
              <label htmlFor="bookingCode" className="text-xs text-[var(--chalk-muted)] font-semibold uppercase tracking-wider font-mono">
                Betting Booking Code
              </label>
              <input
                id="bookingCode"
                value={bookingCode}
                onChange={(e) => setBookingCode(e.target.value)}
                className="w-full font-mono uppercase text-sm"
              />
            </div>

            <div className="field mb-0 space-y-2">
              <label htmlFor="visibility" className="text-xs text-[var(--chalk-muted)] font-semibold uppercase tracking-wider font-mono">
                Subscriber Visibility
              </label>
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

              {visibility === 'plan_specific' && (
                <div className="p-3 rounded-xl bg-[var(--pitch)] border border-[rgba(243,245,236,0.14)] space-y-2 mt-2">
                  <label className="text-xs text-[var(--chalk-muted)] font-semibold uppercase tracking-wider font-mono block">
                    Select Admin-Created Subscription Plans
                  </label>
                  {availablePlans.length === 0 ? (
                    <p className="text-xs text-[var(--chalk-muted)] italic">
                      No subscription plans created by admin yet. Create plans in the Membership Plans section.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      {availablePlans.map((plan) => (
                        <label key={plan.id} className="flex items-center gap-2 text-xs text-white bg-black/40 p-2 rounded-lg border border-[rgba(243,245,236,0.1)] cursor-pointer hover:border-emerald-500/30">
                          <input
                            type="checkbox"
                            checked={planIds.includes(plan.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setPlanIds([...planIds, plan.id]);
                              } else {
                                setPlanIds(planIds.filter((pid) => pid !== plan.id));
                              }
                            }}
                            className="rounded border-zinc-700 bg-zinc-900 text-emerald-400 focus:ring-emerald-400"
                          />
                          <span className="font-medium">{plan.name}</span>
                          <span className="text-[10px] text-[var(--chalk-muted)] ml-auto">({plan.durationDays}d)</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {visibility === 'free_window' && (
              <div className="field mb-0">
                <label htmlFor="freeUntil" className="text-xs text-[var(--chalk-muted)] font-semibold uppercase tracking-wider font-mono">
                  Free Access Until
                </label>
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
              <label htmlFor="bodyNotes" className="text-xs text-[var(--chalk-muted)] font-semibold uppercase tracking-wider font-mono">
                Analyst Notes & Insights
              </label>
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
          </div>

          {/* Attached Matches Summary */}
          <div className="card p-4 sm:p-5 space-y-3">
            <h3 className="text-xs font-semibold text-white uppercase tracking-wider font-mono flex items-center justify-between">
              <span>Attached Match Picks ({(post.items ?? []).length})</span>
            </h3>
            <div className="space-y-2">
              {(post.items ?? []).length === 0 ? (
                <p className="text-xs text-[var(--chalk-muted)] py-2">No match picks items attached to this post.</p>
              ) : (
                (post.items ?? []).map((item) => (
                  <div
                    key={item.id}
                    className="p-3 rounded-lg bg-[var(--pitch)] border border-[rgba(243,245,236,0.08)] flex items-center justify-between text-xs gap-3"
                  >
                    <span className="text-white font-medium truncate">{item.match}</span>
                    <span className="mono text-[var(--floodlight)] font-bold shrink-0">
                      {item.prediction}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Media & Images Column */}
        <div className="lg:col-span-5 space-y-6">
          <div className="card p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[rgba(243,245,236,0.1)]">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <ImageIcon size={18} className="text-emerald-400" />
                <span>Slip Screenshots ({(post.media ?? []).length})</span>
              </h2>
              <span className="text-[11px] text-[var(--chalk-muted)] font-mono">Max 10 images</span>
            </div>

            {/* Upload Box */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className="p-5 rounded-2xl bg-[var(--pitch)] border-2 border-dashed border-emerald-500/30 hover:border-emerald-400 text-center cursor-pointer transition-all space-y-2 group"
            >
              <div className="w-10 h-10 mx-auto rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center group-hover:scale-105 transition-transform">
                <Upload size={20} />
              </div>
              <div className="text-xs font-medium text-white">
                Upload Slip Images (JPG/PNG &lt; 5MB)
              </div>
              <p className="text-[11px] text-[var(--chalk-muted)]">
                Click or drop files to attach additional screenshots
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/jpg"
                onChange={uploadImage}
                disabled={uploading}
                className="hidden"
              />
            </div>

            {uploading && (
              <p className="text-xs text-emerald-400 font-mono text-center animate-pulse flex items-center justify-center gap-2">
                <FileImage size={14} />
                <span>Processing & uploading prediction image…</span>
              </p>
            )}

            {/* Uploaded Media Gallery */}
            <div className="space-y-3 pt-2">
              {(post.media ?? []).length === 0 ? (
                <div className="text-center py-6 border border-dashed border-[rgba(243,245,236,0.1)] rounded-xl">
                  <ImageIcon size={28} className="mx-auto text-[var(--chalk-muted)] mb-2" />
                  <p className="text-xs text-[var(--chalk-muted)]">
                    No screenshot media attached to this prediction.
                  </p>
                </div>
              ) : (
                (post.media ?? []).map((m) => {
                  const mediaUrl = mediaUrls[m.id];
                  return (
                    <div
                      key={m.id}
                      className="p-3 rounded-xl bg-[var(--pitch)] border border-[rgba(243,245,236,0.1)] flex items-center justify-between text-xs gap-3 group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {mediaUrl ? (
                          <div
                            onClick={() => setPreviewModalUrl(mediaUrl)}
                            className="w-12 h-12 rounded-lg overflow-hidden bg-black border border-zinc-700 shrink-0 cursor-pointer relative group/img"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={mediaUrl} alt="Slip" className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 flex items-center justify-center text-white transition-opacity">
                              <Eye size={12} />
                            </div>
                          </div>
                        ) : (
                          <div className="w-12 h-12 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
                            <ImageIcon size={16} className="text-emerald-400" />
                          </div>
                        )}

                        <div className="min-w-0">
                          <div className="mono text-white truncate text-xs font-semibold">
                            {m.storageKey.split('/').pop()}
                          </div>
                          <div className="text-[10px] text-emerald-400 font-mono mt-0.5">
                            Sanitized & Encrypted
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {mediaUrl && (
                          <button
                            onClick={() => setPreviewModalUrl(mediaUrl)}
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                            title="Preview Image"
                          >
                            <Eye size={14} />
                          </button>
                        )}
                        <button
                          onClick={() => deleteImage(m.id)}
                          disabled={deletingMediaId === m.id}
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          title="Delete image"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Lightbox Modal for Image Previews */}
      {previewModalUrl && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative max-w-4xl w-full max-h-[90vh] flex flex-col items-center">
            <button
              onClick={() => setPreviewModalUrl(null)}
              className="absolute -top-10 right-0 p-2 text-white/80 hover:text-white"
            >
              <X size={24} />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewModalUrl}
              alt="Prediction slip full view"
              className="max-h-[85vh] w-auto object-contain rounded-xl border border-zinc-700 shadow-2xl"
            />
          </div>
        </div>
      )}
    </div>
  );
}
