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
      <div className="admin-dash-header">
        <h1 className="admin-dash-title">Predictions &amp; Match Tips</h1>
        <p className="admin-plans-subtitle" style={{ marginTop: 8, maxWidth: 640 }}>
          Publish match slips, image predictions, booking codes, and scheduled betting insights for your subscribers.
        </p>
        <div className="admin-dash-underline" />
      </div>

      {/* Primary Actions */}
      <div className="admin-dash-actions">
        <Link
          href="/admin/predictions/csv"
          className="admin-action-btn-secondary"
          style={{ textDecoration: 'none' }}
        >
          <span className="admin-btn-left">
            <span className="admin-btn-icon-box-gold">
              <Upload size={16} />
            </span>
            <span>
              <span style={{ display: 'block', fontWeight: 700, fontSize: 15 }}>Import CSV</span>
              <span style={{ display: 'block', fontSize: 12, opacity: 0.75, marginTop: 2 }}>Bulk upload tips</span>
            </span>
          </span>
          <ChevronRight size={16} style={{ opacity: 0.6 }} />
        </Link>

        <button
          type="button"
          onClick={() => setShowManualForm((s) => !s)}
          className="admin-action-btn-primary"
        >
          <span className="admin-btn-left">
            <span className="admin-btn-icon-box-dark">
              {showManualForm ? <X size={16} /> : <Plus size={16} />}
            </span>
            <span>
              <span style={{ display: 'block', fontWeight: 700, fontSize: 15 }}>
                {showManualForm ? 'Close Form' : 'New Tip Post'}
              </span>
              <span style={{ display: 'block', fontSize: 12, opacity: 0.8, marginTop: 2 }}>
                {showManualForm ? 'Cancel editing' : 'Create manually'}
              </span>
            </span>
          </span>
          {!showManualForm && <ChevronRight size={16} style={{ opacity: 0.7 }} />}
        </button>
      </div>

      {/* Manual Compose Form */}
      {showManualForm && (
        <div className="card" style={{ padding: '24px', borderRadius: 18, border: '1px solid rgba(243,245,236,0.14)', background: '#102e20' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <span style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(245,179,53,0.14)', border: '1px solid rgba(245,179,53,0.3)', color: '#f5b335', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <Plus size={18} />
            </span>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#ffffff', margin: 0 }}>Compose Matchday Prediction Post</h2>
              <p style={{ fontSize: 12, color: '#85a694', margin: 0 }}>Create a new prediction with match picks and optional slip screenshots.</p>
            </div>
          </div>

          <form onSubmit={createPost} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label htmlFor="title" style={{ fontSize: 12, fontWeight: 600, color: '#85a694', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Post Title
                </label>
                <input
                  id="title"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Saturday European Big 5 Banker"
                  style={inputStyle}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label htmlFor="scheduledAt" style={{ fontSize: 12, fontWeight: 600, color: '#85a694', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Scheduled Match Time
                  </label>
                  <input
                    id="scheduledAt"
                    type="datetime-local"
                    required
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label htmlFor="bookingCode" style={{ fontSize: 12, fontWeight: 600, color: '#85a694', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Betting Booking Code
                  </label>
                  <input
                    id="bookingCode"
                    required
                    value={bookingCode}
                    onChange={(e) => setBookingCode(e.target.value)}
                    placeholder="e.g. BC-98342 or SportyBet code"
                    style={{ ...inputStyle, fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label htmlFor="visibility" style={{ fontSize: 12, fontWeight: 600, color: '#85a694', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Subscriber Visibility
                </label>
                <select
                  id="visibility"
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as any)}
                  style={selectStyle}
                >
                  <option value="subscribers">All Active Subscribers</option>
                  <option value="plan_specific">Plan-Specific VIPs</option>
                  <option value="free_window">Free Window (Promotional)</option>
                </select>

                {visibility === 'plan_specific' && (
                  <div style={{ padding: 14, borderRadius: 12, background: '#0b2216', border: '1px solid rgba(243,245,236,0.14)', marginTop: 8 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#85a694', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 8 }}>
                      Select Admin-Created Subscription Plans
                    </label>
                    {availablePlans.length === 0 ? (
                      <p style={{ fontSize: 12, color: '#9fb3a6', fontStyle: 'italic' }}>
                        No subscription plans created by admin yet. Create plans in the Membership Plans section.
                      </p>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                        {availablePlans.map((plan) => (
                          <label key={plan.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#ffffff', background: '#0f2b1d', padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(243,245,236,0.1)', cursor: 'pointer' }}>
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
                              style={{ borderRadius: 4, borderColor: '#374151', background: '#111827', color: '#f5b335' }}
                            />
                            <span style={{ fontWeight: 500 }}>{plan.name}</span>
                            <span style={{ fontSize: 11, color: '#85a694', marginLeft: 'auto' }}>({plan.durationDays}d)</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Attach Slip Screenshots */}
            <div style={{ padding: 16, borderRadius: 14, background: '#0f2b1d', border: '1px dashed rgba(243,245,236,0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(245,179,53,0.14)', border: '1px solid rgba(245,179,53,0.3)', color: '#f5b335', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ImageIcon size={14} />
                  </span>
                  Attach Slip Screenshots ({selectedFiles.length}/10)
                </label>
                <span style={{ fontSize: 11, color: '#85a694' }}>JPG, PNG (Max 5MB each)</span>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => manualFileInputRef.current?.click()}
                  style={{ ...inputStyle, background: 'transparent', border: '1px solid rgba(243,245,236,0.18)', color: '#f3f5ec', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px', fontSize: 13, fontWeight: 600 }}
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 14 }}>
                  {selectedFiles.map((file, idx) => (
                    <div key={idx} style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(243,245,236,0.15)', background: 'rgba(0,0,0,0.4)', aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={filePreviews[idx]} alt={file.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', opacity: 0, transition: 'opacity 0.15s ease', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 8 }} className="group-hover:opacity-100">
                        <span style={{ fontSize: 10, color: '#ffffff', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{file.name}</span>
                        <button
                          type="button"
                          onClick={() => removeSelectedFile(idx)}
                          style={{ padding: '6px 10px', borderRadius: 6, background: '#dc2626', color: '#ffffff', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Individual Match Predictions ({items.length})
                </label>
                <button
                  type="button"
                  onClick={() => setItems([...items, emptyItem()])}
                  style={{ fontSize: 12, color: '#f5b335', background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <Plus size={12} />
                  Add Another Match
                </button>
              </div>

              {items.map((item, i) => (
                <div key={i} style={{ padding: 12, borderRadius: 12, background: '#0b2216', border: '1px solid rgba(243,245,236,0.1)', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <input
                      placeholder="Teams (e.g. Arsenal vs Chelsea)"
                      value={item.match}
                      onChange={(e) => setItems(items.map((it, idx) => (idx === i ? { ...it, match: e.target.value } : it)))}
                      style={{ ...inputStyle, background: 'transparent', border: 'none', padding: '4px 0' }}
                    />
                  </div>
                  <div style={{ width: 180, borderTop: '1px solid rgba(243,245,236,0.1)', paddingTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      placeholder="Pick (e.g. Over 2.5 @ 1.85)"
                      value={item.prediction}
                      onChange={(e) => setItems(items.map((it, idx) => (idx === i ? { ...it, prediction: e.target.value } : it)))}
                      style={{ ...inputStyle, background: 'transparent', border: 'none', padding: '4px 0', color: '#f5b335', fontFamily: 'var(--font-mono)' }}
                    />
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setItems(items.filter((_, idx) => idx !== i))}
                        style={{ background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: 4 }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {error && (
              <div style={{ padding: 12, borderRadius: 10, background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)', color: '#fca5a5', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <ShieldAlert size={16} style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}

            {uploadStatus && (
              <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: '#f5b335', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f5b335', animation: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite' }} />
                <span>{uploadStatus}</span>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, paddingTop: 6 }}>
              <button
                type="submit"
                disabled={saving}
                style={{ ...primaryButtonStyle, opacity: saving ? 0.7 : 1 }}
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
                style={{ ...ghostButtonStyle, border: '1px solid rgba(243,245,236,0.14)', color: '#85a694' }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Feed Archive Card */}
      <div className="card" style={{ padding: '28px', borderRadius: 18, background: '#102e20', border: '1px solid rgba(243,245,236,0.14)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#ffffff', margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span>Feed Archive ({posts.length})</span>
          </h2>
          <p style={{ fontSize: 12, color: '#85a694', margin: 0 }}>Live Tips Repository &amp; Published Slips</p>
        </div>

        {loading ? (
          <div style={{ padding: '48px 16px', textAlign: 'center', fontSize: 13, color: '#85a694', fontFamily: 'var(--font-mono)' }} className="animate-pulse">
            Loading match posts…
          </div>
        ) : posts.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {posts.map((p) => (
              <div
                key={p.id}
                style={{ padding: 18, borderRadius: 14, background: '#0f2b1d', border: '1px solid rgba(243,245,236,0.1)', display: 'flex', flexDirection: 'column', gap: 12, transition: 'border-color 0.15s ease' }}
                className="group"
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 16, color: '#ffffff', transition: 'color 0.15s ease' }} className="group-hover:text-[#f5b335]">
                      {p.title}
                    </span>

                    <span
                      style={{
                        padding: '3px 10px',
                        fontSize: 10,
                        fontWeight: 800,
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        borderRadius: 9999,
                        border: '1px solid',
                        ...(p.status === 'published'
                          ? { background: 'rgba(16,185,129,0.15)', color: '#34d399', borderColor: 'rgba(52,211,153,0.35)' }
                          : { background: 'rgba(245,178,61,0.15)', color: '#fbbf24', borderColor: 'rgba(251,191,36,0.35)' }),
                      }}
                    >
                      {p.status}
                    </span>

                    {p.media && p.media.length > 0 && (
                      <span style={{ padding: '2px 8px', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600, background: 'rgba(168,85,247,0.12)', color: '#c084fc', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <ImageIcon size={11} />
                        <span>{p.media.length} slip image{p.media.length > 1 ? 's' : ''}</span>
                      </span>
                    )}

                    <span style={{ padding: '2px 8px', fontSize: 10, fontFamily: 'var(--font-mono)', color: '#9fb3a6', background: 'rgba(0,0,0,0.25)', borderRadius: 6 }}>
                      {p.visibility === 'subscribers'
                        ? 'All Active Subscribers'
                        : p.visibility === 'plan_specific'
                          ? p.planIds && p.planIds.length > 0
                            ? `Plans: ${p.planIds.map((id) => availablePlans.find((ap) => ap.id === id)?.name || id).join(', ')}`
                            : 'VIP Plan Only'
                          : 'Free Window'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12, color: '#85a694', fontFamily: 'var(--font-mono)' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
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

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
                  <Link
                    href={`/admin/predictions/${p.id}`}
                    style={{ ...ghostButtonStyle, border: '1px solid rgba(243,245,236,0.12)', color: '#f3f5ec', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', fontSize: 12 }}
                  >
                    <Edit size={13} />
                    <span>Edit Post &amp; Slip</span>
                  </Link>
                  {p.status !== 'published' && (
                    <button
                      onClick={() => publish(p.id)}
                      style={{ ...primaryButtonStyle, padding: '8px 14px', fontSize: 12 }}
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
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ position: 'relative', maxWidth: 1024, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <button
              onClick={() => setPreviewImageUrl(null)}
              style={{ position: 'absolute', top: -40, right: 0, background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.8)', cursor: 'pointer', padding: 8 }}
            >
              <X size={24} />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewImageUrl}
              alt="Prediction slip full view"
              style={{ maxHeight: '85vh', width: 'auto', objectFit: 'contain', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ padding: '48px 24px', textAlign: 'center', border: '1px dashed rgba(243,245,236,0.14)', borderRadius: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      <div style={{ width: 64, height: 64, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#10b981' }}>
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
        <p style={{ fontSize: 14, color: '#9fb3a6', fontWeight: 500, margin: 0 }}>
          No match predictions found in this category.
        </p>
        <p style={{ fontSize: 12, color: 'rgba(159,179,166,0.8)', margin: 0 }}>
          Click &quot;New Tip Post&quot; or &quot;Import CSV&quot; to publish your match predictions.
        </p>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#0b2216',
  border: '1px solid rgba(243,245,236,0.14)',
  borderRadius: 12,
  padding: '12px 14px',
  color: '#f3f5ec',
  fontSize: 14,
  fontFamily: 'inherit',
  outline: 'none',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: 'none',
  cursor: 'pointer',
};

const primaryButtonStyle: React.CSSProperties = {
  background: '#f5b335',
  color: '#0a2116',
  border: 'none',
  borderRadius: 12,
  padding: '12px 20px',
  fontSize: 14,
  fontWeight: 700,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  cursor: 'pointer',
  boxShadow: '0 4px 14px rgba(245,179,53,0.18)',
  transition: 'filter 0.15s ease, transform 0.1s ease',
};

const ghostButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 12,
  padding: '12px 20px',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 0.15s ease',
};
