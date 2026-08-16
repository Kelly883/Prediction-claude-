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
  Plus,
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

  function handleVisibilityChange(value: 'plan_specific' | 'subscribers' | 'free_window') {
    setVisibility(value);
    if (value === 'plan_specific') {
      setPlanIds([]);
    } else if (value === 'subscribers') {
      setPlanIds(availablePlans.map((p) => p.id));
    } else {
      setPlanIds([]);
    }
  }

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

  // When plans load and visibility is subscribers, default to all plans selected
  useEffect(() => {
    if (visibility === 'subscribers' && availablePlans.length > 0 && planIds.length === 0) {
      setPlanIds(availablePlans.map((p) => p.id));
    }
  }, [availablePlans, visibility, planIds.length]);

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
          planIds: (visibility === 'subscribers' || visibility === 'plan_specific') ? planIds : [],
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
      <div className="admin-loading">
        Loading prediction post details…
      </div>
    );
  }

  if (!post) {
    return (
      <div className="admin-empty-state">
        <AlertTriangle size={28} className="text-red-400" style={{ marginBottom: 8 }} />
        <p className="admin-empty-state-title">Post not found</p>
        <Link href="/admin/predictions" className="admin-back-btn">
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
            className="admin-back-btn"
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
                className={`admin-status-pill ${post.status === 'published' ? 'admin-status-pill-success' : 'admin-status-pill-warning'}`}
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
              className="admin-back-btn border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
            >
              <CheckCircle2 size={14} />
              <span>Publish Live</span>
            </button>
          )}
          <button
            onClick={archive}
            className="admin-back-btn border-red-500/30 text-red-400 hover:bg-red-500/10"
          >
            <Archive size={14} />
            <span>Archive Post</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Post Form Column */}
        <div className="lg:col-span-7 space-y-6">
          <div className="admin-compose-card">
            <div className="admin-compose-header">
              <div className="admin-compose-header-icon">
                <Sparkles size={16} />
              </div>
              <h2 className="admin-compose-title" style={{ margin: 0 }}>Post Configuration</h2>
            </div>

            <div className="flex flex-col gap-4">
              <div className="admin-form-group">
                <label htmlFor="title" className="admin-form-label">Title</label>
                <input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="admin-input text-sm font-medium"
                />
              </div>

              <div className="admin-form-group">
                <label htmlFor="bookingCode" className="admin-form-label">Betting Booking Code</label>
                <input
                  id="bookingCode"
                  value={bookingCode}
                  onChange={(e) => setBookingCode(e.target.value)}
                  className="admin-input text-sm font-medium mono-text"
                  style={{ fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}
                />
              </div>

              <div className="admin-form-group">
                <label htmlFor="visibility" className="admin-form-label">Subscriber Visibility</label>
                <select
                  id="visibility"
                  value={visibility}
                  onChange={(e) => handleVisibilityChange(e.target.value as any)}
                  className="admin-select"
                >
                  <option value="subscribers">All Active Subscribers</option>
                  <option value="plan_specific">Plan-Specific VIPs</option>
                  <option value="free_window">Free Window (Promotional)</option>
                </select>

                {(visibility === 'subscribers' || visibility === 'plan_specific') && (
                  <div className="p-3 rounded-xl bg-[var(--pitch)] border border-[rgba(243,245,236,0.14)] space-y-2 mt-2">
                    <label className="text-xs text-[#85a694] font-semibold uppercase tracking-wider font-mono block">
                      {visibility === 'subscribers' ? 'Visible To All Admin-Created Plans' : 'Select Admin-Created Subscription Plans'}
                    </label>
                    {availablePlans.length === 0 ? (
                      <p className="text-xs text-[#85a694] italic">
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
                <div className="admin-form-group">
                  <label htmlFor="freeUntil" className="admin-form-label">Free Access Until</label>
                  <input
                    id="freeUntil"
                    type="datetime-local"
                    value={freeUntil}
                    onChange={(e) => setFreeUntil(e.target.value)}
                    className="admin-input text-sm"
                  />
                </div>
              )}

              <div className="admin-form-group">
                <label htmlFor="bodyNotes" className="admin-form-label">Analyst Notes &amp; Insights</label>
                <textarea
                  id="bodyNotes"
                  rows={4}
                  value={bodyNotes}
                  onChange={(e) => setBodyNotes(e.target.value)}
                  placeholder="Add match preview commentary, weather updates, or accumulator tips…"
                  className="admin-textarea"
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
          </div>

          {/* Attached Matches Summary */}
          <div className="admin-compose-card">
            <div className="admin-card-header">
              <h2 className="admin-card-title">Attached Match Picks ({(post.items ?? []).length})</h2>
            </div>
            <div className="flex flex-col gap-2">
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
          <div className="admin-compose-card">
            <div className="admin-card-header">
              <div className="flex items-center gap-2">
                <ImageIcon size={18} className="text-emerald-400" />
                <h2 className="admin-card-title" style={{ margin: 0 }}>Slip Screenshots ({(post.media ?? []).length})</h2>
              </div>
              <span className="text-[11px] text-[var(--chalk-muted)] font-mono">Max 10 images</span>
            </div>

            {/* Upload Box */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className="admin-upload-box"
            >
              <div className="admin-upload-icon-box">
                <Upload size={20} />
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>
                Upload Slip Images (JPG/PNG &lt; 5MB)
              </div>
              <p style={{ fontSize: 11, color: '#85a694' }}>
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
              <p style={{ fontSize: 12, color: '#10b981', fontFamily: 'var(--font-mono), monospace', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} className="animate-pulse">
                <FileImage size={14} />
                <span>Processing &amp; uploading prediction image…</span>
              </p>
            )}

            {/* Uploaded Media Gallery */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8 }}>
              {(post.media ?? []).length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 16px', border: '1px dashed rgba(243,245,236,0.1)', borderRadius: 12 }}>
                  <ImageIcon size={28} style={{ margin: '0 auto 8px', color: '#85a694' }} />
                  <p style={{ fontSize: 12, color: '#85a694' }}>
                    No screenshot media attached to this prediction.
                  </p>
                </div>
              ) : (
                (post.media ?? []).map((m) => {
                  const mediaUrl = mediaUrls[m.id];
                  return (
                    <div
                      key={m.id}
                      className="admin-media-item"
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                        {mediaUrl ? (
                          <div
                            onClick={() => setPreviewModalUrl(mediaUrl)}
                            className="admin-media-thumb"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={mediaUrl} alt="Slip" />
                            <div className="admin-media-overlay">
                              <Eye size={12} />
                            </div>
                          </div>
                        ) : (
                          <div className="admin-media-thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <ImageIcon size={16} style={{ color: '#10b981' }} />
                          </div>
                        )}

                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontFamily: 'var(--font-mono), monospace', color: '#ffffff', fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {m.storageKey.split('/').pop()}
                          </div>
                          <div style={{ fontSize: 10, color: '#10b981', fontFamily: 'var(--font-mono), monospace', marginTop: 2 }}>
                            Sanitized &amp; Encrypted
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        {mediaUrl && (
                          <button
                            onClick={() => setPreviewModalUrl(mediaUrl)}
                            className="admin-media-btn"
                            title="Preview Image"
                          >
                            <Eye size={14} />
                          </button>
                        )}
                        <button
                          onClick={() => deleteImage(m.id)}
                          disabled={deletingMediaId === m.id}
                          className="admin-media-btn admin-media-btn-delete"
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
        <div className="admin-lightbox">
          <div style={{ position: 'relative', maxWidth: 1024, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <button
              onClick={() => setPreviewModalUrl(null)}
              style={{ position: 'absolute', top: -40, right: 0, padding: 8, color: 'rgba(255,255,255,0.8)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              <X size={24} />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewModalUrl}
              alt="Prediction slip full view"
              className="admin-lightbox-img"
            />
          </div>
        </div>
      )}
    </div>
  );
}
