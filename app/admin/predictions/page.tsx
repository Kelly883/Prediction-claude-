'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { apiJson, apiFetch } from '@/lib/api-client';
import {
  Plus,
  Upload,
  Trash2,
  Edit,
  CheckCircle2,
  Calendar,
  Image as ImageIcon,
  ChevronRight,
  X,
  FileImage,
  ShieldAlert,
  Layers,
  FileCheck,
  Clock,
  Eye,
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
  scheduledAt: string;
  bookingCode: string;
  visibility: 'plan_specific' | 'subscribers' | 'free_window';
  planIds?: string[];
  items?: PostItem[];
  media?: MediaAsset[];
};

const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/jpg'];

const emptyItem = () => ({ match: '', prediction: '' });

export default function AdminPredictionsPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [availablePlans, setAvailablePlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);

  const [showManualForm, setShowManualForm] = useState(false);

  const [title, setTitle] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [bookingCode, setBookingCode] = useState('');
  const [visibility, setVisibility] = useState<'plan_specific' | 'subscribers' | 'free_window'>('subscribers');
  const [selectedPlanIds, setSelectedPlanIds] = useState<string[]>([]);
  const [items, setItems] = useState([emptyItem()]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<string[]>([]);
  const manualFileInputRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  function load() {
    apiJson<Post[]>('/api/predictions')
      .then(setPosts)
      .finally(() => setLoading(false));
    apiJson<SubscriptionPlan[]>('/api/plans')
      .then(setAvailablePlans)
      .catch(() => {});
  }

  useEffect(load, []);

  useEffect(() => {
    return () => {
      filePreviews.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [filePreviews]);

  function validateFiles(files: File[], currentCount: number): { valid: File[]; error?: string } {
    const valid: File[] = [];
    for (const file of files) {
      if (!ALLOWED_MIME_TYPES.includes(file.type.toLowerCase())) {
        return { valid: [], error: `"${file.name}" is not a supported format. Only JPG and PNG images are allowed.` };
      }
      if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
        return { valid: [], error: `"${file.name}" exceeds the maximum allowed file size of 5 MB.` };
      }
      if (currentCount + valid.length >= 10) {
        return { valid, error: 'Maximum of 10 images can be attached per prediction post.' };
      }
      valid.push(file);
    }
    return { valid };
  }

  function handleFileSelection(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    const { valid, error: valErr } = validateFiles(files, selectedFiles.length);
    if (valErr) {
      setError(valErr);
      if (!valid.length) return;
    }

    const newPreviews = valid.map((f) => URL.createObjectURL(f));
    setSelectedFiles((prev) => [...prev, ...valid]);
    setFilePreviews((prev) => [...prev, ...newPreviews]);

    if (manualFileInputRef.current) manualFileInputRef.current.value = '';
  }

  function removeSelectedFile(index: number) {
    URL.revokeObjectURL(filePreviews[index]);
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    setFilePreviews((prev) => prev.filter((_, i) => i !== index));
  }

  async function createPost(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setUploadStatus(null);

    try {
      const newPost = await apiJson<Post>('/api/admin/predictions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          scheduledAt: new Date(scheduledAt).toISOString(),
          bookingCode,
          visibility,
          planIds: visibility === 'plan_specific' ? selectedPlanIds : [],
          items: items.filter((i) => i.match && i.prediction),
        }),
      });

      if (selectedFiles.length > 0) {
        setUploadStatus(`Uploading ${selectedFiles.length} slip screenshot(s)…`);
        for (let i = 0; i < selectedFiles.length; i++) {
          const file = selectedFiles[i];
          setUploadStatus(`Uploading image ${i + 1} of ${selectedFiles.length}…`);
          const formData = new FormData();
          formData.append('file', file);
          const res = await apiFetch(`/api/admin/predictions/${newPost.id}/images`, {
            method: 'POST',
            body: formData,
          });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error ?? `Failed to upload image "${file.name}"`);
          }
        }
      }

      setTitle('');
      setScheduledAt('');
      setBookingCode('');
      setSelectedPlanIds([]);
      setItems([emptyItem()]);
      setSelectedFiles([]);
      setFilePreviews([]);
      setShowManualForm(false);
      setUploadStatus(null);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
      setUploadStatus(null);
    }
  }

  async function publish(id: string) {
    await apiJson(`/api/admin/predictions/${id}/publish`, { method: 'POST' });
    load();
  }

  const totalPosts = posts.length;
  const publishedPosts = posts.filter((p) => p.status === 'published').length;
  const draftPosts = posts.filter((p) => p.status !== 'published').length;
  const postsWithImages = posts.filter((p) => p.media && p.media.length > 0).length;

  return (
    <div className="admin-dash-wrap">
      {/* Page Header */}
      <div className="admin-page-header">
        <div className="admin-page-eyebrow">Predictions &amp; Match Tips</div>
        <h1 className="admin-page-title">Predictions &amp; Match Tips</h1>
        <p className="admin-page-subtitle">Publish match slips, image predictions, booking codes, and scheduled betting insights for your subscribers.</p>
        <div className="admin-underline" />
      </div>

      {/* Primary Actions */}
      <div className="admin-actions-row">
        <Link
          href="/admin/predictions/csv"
          className="admin-action-secondary"
          style={{ textDecoration: 'none' }}
        >
          <div className="admin-action-left">
            <div className="admin-action-icon-box-gold">
              <Upload size={16} />
            </div>
            <div>
              <div style={{ display: 'block', fontWeight: 700, fontSize: 15 }}>Import CSV</div>
              <div style={{ display: 'block', fontSize: 12, opacity: 0.75, marginTop: 2 }}>Bulk upload tips</div>
            </div>
          </div>
          <ChevronRight size={16} style={{ opacity: 0.6 }} />
        </Link>

        <button
          type="button"
          onClick={() => setShowManualForm((s) => !s)}
          className="admin-action-primary"
        >
          <div className="admin-action-left">
            <div className="admin-action-icon-box-dark">
              {showManualForm ? <X size={16} /> : <Plus size={16} />}
            </div>
            <div>
              <div style={{ display: 'block', fontWeight: 700, fontSize: 15 }}>
                {showManualForm ? 'Close Form' : 'New Tip Post'}
              </div>
              <div style={{ display: 'block', fontSize: 12, opacity: 0.8, marginTop: 2 }}>
                {showManualForm ? 'Cancel editing' : 'Create manually'}
              </div>
            </div>
          </div>
          {!showManualForm && <ChevronRight size={16} style={{ opacity: 0.7 }} />}
        </button>
      </div>

      {/* Manual Compose Form */}
      {showManualForm && (
        <div className="admin-compose-card">
          <div className="admin-compose-header">
            <div className="admin-compose-header-icon">
              <Plus size={18} />
            </div>
            <div>
              <h2 className="admin-compose-title">Compose Matchday Prediction Post</h2>
              <p className="admin-compose-subtitle">Create a new prediction with match picks and optional slip screenshots.</p>
            </div>
          </div>

          <form onSubmit={createPost} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4">
              <div className="admin-form-group">
                <label htmlFor="title" className="admin-form-label">Post Title</label>
                <input
                  id="title"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Saturday European Big 5 Banker"
                  className="admin-input"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="admin-form-group">
                  <label htmlFor="scheduledAt" className="admin-form-label">Scheduled Match Time</label>
                  <input
                    id="scheduledAt"
                    type="datetime-local"
                    required
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className="admin-input"
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
                    className="admin-input mono-text"
                    style={{ fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}
                  />
                </div>
              </div>

              <div className="admin-form-group">
                <label htmlFor="visibility" className="admin-form-label">Subscriber Visibility</label>
                <select
                  id="visibility"
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as any)}
                  className="admin-select"
                >
                  <option value="subscribers">All Active Subscribers</option>
                  <option value="plan_specific">Plan-Specific VIPs</option>
                  <option value="free_window">Free Window (Promotional)</option>
                </select>

                {visibility === 'plan_specific' && (
                  <div className="p-3 rounded-xl bg-[var(--pitch)] border border-[rgba(243,245,236,0.14)] space-y-2 mt-2">
                    <label className="text-xs text-[#85a694] font-semibold uppercase tracking-wider font-mono block">
                      Select Admin-Created Subscription Plans
                    </label>
                    {availablePlans.length === 0 ? (
                      <p className="text-xs text-[#9fb3a6] italic">
                        No subscription plans created by admin yet. Create plans in the Membership Plans section.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 gap-2">
                        {availablePlans.map((plan) => (
                          <label key={plan.id} className="flex items-center gap-2 text-xs text-white bg-[#0f2b1d] p-2 rounded-lg border border-[rgba(243,245,236,0.1)] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedPlanIds.includes(plan.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedPlanIds([...selectedPlanIds, plan.id]);
                                } else {
                                  setSelectedPlanIds(selectedPlanIds.filter((id) => id !== plan.id));
                                }
                              }}
                              className="rounded border-zinc-700 bg-zinc-900 text-[#f5b335] focus:ring-[#f5b335]"
                            />
                            <span className="font-medium">{plan.name}</span>
                            <span className="text-[10px] text-[#85a694] ml-auto">({plan.durationDays}d)</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Attach Slip Screenshots */}
            <div className="admin-upload-area">
              <div className="admin-upload-area-header">
                <label className="admin-upload-area-label">
                  <span className="admin-upload-area-label-icon">
                    <ImageIcon size={14} />
                  </span>
                  Attach Slip Screenshots ({selectedFiles.length}/10)
                </label>
                <span className="text-[11px] text-[#85a694]">JPG, PNG (Max 5MB each)</span>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => manualFileInputRef.current?.click()}
                  className="admin-upload-btn"
                >
                  <FileImage size={15} style={{ color: '#f5b335' }} />
                  Attach Slip Screenshots
                </button>
                <input
                  ref={manualFileInputRef}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/jpg"
                  onChange={handleFileSelection}
                  className="hidden"
                />
              </div>

              {selectedFiles.length > 0 && (
                <div className="admin-upload-grid">
                  {selectedFiles.map((file, idx) => (
                    <div key={idx} className="admin-upload-preview">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={filePreviews[idx]} alt={file.name} />
                      <div className="admin-upload-preview-overlay">
                        <span className="admin-upload-preview-name">{file.name}</span>
                        <button
                          type="button"
                          onClick={() => removeSelectedFile(idx)}
                          className="admin-upload-preview-remove"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Dynamic Match Items */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-white uppercase" style={{ letterSpacing: '0.08em' }}>
                  Individual Match Predictions ({items.length})
                </label>
                <button
                  type="button"
                  onClick={() => setItems([...items, emptyItem()])}
                  className="text-xs text-[#f5b335] bg-transparent border-none cursor-pointer font-semibold inline-flex items-center gap-1"
                >
                  <Plus size={12} />
                  Add Another Match
                </button>
              </div>

              {items.map((item, i) => (
                <div key={i} className="admin-match-item">
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <input
                      placeholder="Teams (e.g. Arsenal vs Chelsea)"
                      value={item.match}
                      onChange={(e) => setItems(items.map((it, idx) => (idx === i ? { ...it, match: e.target.value } : it)))}
                      className="admin-match-item-input"
                    />
                  </div>
                  <div style={{ width: 180, borderTop: '1px solid rgba(243,245,236,0.1)', paddingTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      placeholder="Pick (e.g. Over 2.5 @ 1.85)"
                      value={item.prediction}
                      onChange={(e) => setItems(items.map((it, idx) => (idx === i ? { ...it, prediction: e.target.value } : it)))}
                      className="admin-match-item-input-pick"
                    />
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setItems(items.filter((_, idx) => idx !== i))}
                        className="p-1 bg-transparent border-none text-zinc-400 cursor-pointer hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
                <ShieldAlert size={16} className="shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {uploadStatus && (
              <div className="text-xs flex items-center gap-2" style={{ fontFamily: 'var(--font-mono)', color: '#f5b335' }}>
                <span className="w-2 h-2 rounded-full bg-[#f5b335] animate-pulse" />
                <span>{uploadStatus}</span>
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={saving}
                className="btn btn-primary py-2.5 px-5 text-sm font-semibold flex items-center justify-center gap-2"
                style={{ opacity: saving ? 0.7 : 1 }}
              >
                {saving ? 'Saving Post & Media…' : 'Save as Draft'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowManualForm(false);
                  setSelectedFiles([]);
                  setFilePreviews([]);
                }}
                className="btn btn-ghost py-2.5 px-4 text-sm border border-[rgba(243,245,236,0.14)] text-[#85a694]"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Feed Archive Card */}
      <div className="admin-compose-card">
        <div className="admin-card-header">
          <div>
            <h2 className="admin-card-title">Feed Archive ({posts.length})</h2>
            <p className="admin-card-subtitle">Live Tips Repository &amp; Published Slips</p>
          </div>
        </div>

        {loading ? (
          <div className="admin-loading animate-pulse">Loading match posts…</div>
        ) : posts.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col gap-3">
            {posts.map((p) => (
              <div
                key={p.id}
                className="admin-post-card group"
              >
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="admin-post-card-title group-hover:text-[#f5b335]">{p.title}</span>

                    <span
                      className={`admin-tag ${p.status === 'published' ? 'admin-tag-success' : 'admin-tag-warning'}`}
                    >
                      {p.status}
                    </span>

                    {p.media && p.media.length > 0 && (
                      <span className="admin-tag admin-tag-purple">
                        <ImageIcon size={11} />
                        <span>{p.media.length} slip image{p.media.length > 1 ? 's' : ''}</span>
                      </span>
                    )}

                    <span className="admin-tag-mono">
                      {p.visibility === 'subscribers'
                        ? 'All Active Subscribers'
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
                    {p.items && p.items.length > 0 && (
                      <>
                        <span style={{ color: '#9fb3a6' }}>•</span>
                        <span>{p.items.length} match pick{p.items.length > 1 ? 's' : ''}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="admin-post-card-actions">
                  <Link
                    href={`/admin/predictions/${p.id}`}
                    className="admin-back-btn"
                    style={{ padding: '8px 12px', fontSize: 12 }}
                  >
                    <Edit size={13} />
                    <span>Edit Post &amp; Slip</span>
                  </Link>
                  {p.status !== 'published' && (
                    <button
                      onClick={() => publish(p.id)}
                      className="btn btn-primary"
                      style={{ padding: '8px 14px', fontSize: 12 }}
                    >
                      <CheckCircle2 size={13} />
                      <span>Publish</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox Modal */}
      {previewImageUrl && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative max-w-4xl w-full max-h-[90vh] flex flex-col items-center">
            <button
              onClick={() => setPreviewImageUrl(null)}
              className="absolute -top-10 right-0 p-2 text-white/80 hover:text-white bg-transparent border-none cursor-pointer"
            >
              <X size={24} />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewImageUrl}
              alt="Prediction slip full view"
              className="max-h-[85vh] w-auto object-contain rounded-xl border border-zinc-700 shadow-2xl"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
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
        <p className="admin-empty-state-title">No match predictions found in this category.</p>
        <p className="admin-empty-state-desc">Click &quot;New Tip Post&quot; or &quot;Import CSV&quot; to publish your match predictions.</p>
      </div>
    </div>
  );
}
