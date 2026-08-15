'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { apiJson, apiFetch } from '@/lib/api-client';
import {
  Sparkles,
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
} from 'lucide-react';

type MediaAsset = { id: string; storageKey: string };
type PostItem = { id?: string; match: string; prediction: string };
type Post = {
  id: string;
  title: string;
  status: string;
  scheduledAt: string;
  bookingCode: string;
  items?: PostItem[];
  media?: MediaAsset[];
};

const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/jpg'];

const emptyItem = () => ({ match: '', prediction: '' });

export default function AdminPredictionsPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  // Form fields
  const [title, setTitle] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [bookingCode, setBookingCode] = useState('');
  const [visibility, setVisibility] = useState<'plan_specific' | 'subscribers' | 'free_window'>('subscribers');
  const [items, setItems] = useState([emptyItem()]);

  // Image files selected for upload
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  function load() {
    apiJson<Post[]>('/api/predictions')
      .then(setPosts)
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  // Cleanup object URLs when previews change
  useEffect(() => {
    return () => {
      filePreviews.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [filePreviews]);

  function handleFileSelection(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    const validFiles: File[] = [];
    const newPreviews: string[] = [];

    for (const file of files) {
      if (!ALLOWED_MIME_TYPES.includes(file.type.toLowerCase())) {
        setError(`"${file.name}" is not a supported format. Only JPG and PNG images are allowed.`);
        return;
      }
      if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
        setError(`"${file.name}" exceeds the maximum allowed file size of 5 MB.`);
        return;
      }
      if (selectedFiles.length + validFiles.length >= 10) {
        setError('Maximum of 10 images can be attached per prediction post.');
        break;
      }
      validFiles.push(file);
      newPreviews.push(URL.createObjectURL(file));
    }

    setSelectedFiles((prev) => [...prev, ...validFiles]);
    setFilePreviews((prev) => [...prev, ...newPreviews]);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
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
      // Step 1: Create prediction post draft
      const newPost = await apiJson<Post>('/api/admin/predictions', {
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

      // Step 2: Upload selected images if any
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

      // Reset form
      setTitle('');
      setScheduledAt('');
      setBookingCode('');
      setItems([emptyItem()]);
      setSelectedFiles([]);
      setFilePreviews([]);
      setShowForm(false);
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

  return (
    <div className="space-y-6">
      {/* Top Header matching design layout */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 pb-2">
        <div>
          <h1 className="font-bold text-2xl sm:text-3xl text-white tracking-tight">Predictions & Match Tips</h1>
          <p className="text-xs sm:text-sm text-[var(--chalk-muted)] mt-1">
            Publish match slips, booking codes, and scheduled betting insights.
          </p>
        </div>

        {/* Action Buttons styled according to image design */}
        <div className="grid grid-cols-2 gap-3 sm:flex sm:items-center">
          <Link
            href="/admin/predictions/csv"
            className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-[var(--pitch)] border border-[rgba(243,245,236,0.12)] hover:border-[rgba(243,245,236,0.25)] transition-all group"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                <Upload size={18} />
              </div>
              <div className="text-left">
                <div className="text-xs sm:text-sm font-bold text-white leading-snug">Import CSV</div>
                <div className="text-[11px] text-[var(--chalk-muted)]">Bulk upload tips</div>
              </div>
            </div>
            <ChevronRight size={16} className="text-[var(--chalk-muted)] group-hover:text-white transition-colors" />
          </Link>

          <button
            onClick={() => setShowForm((s) => !s)}
            className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-[var(--floodlight)] text-[var(--pitch)] font-bold transition-all hover:bg-[#f3bc20] group"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[var(--pitch)] text-[var(--floodlight)] flex items-center justify-center shrink-0">
                {showForm ? <X size={18} /> : <Plus size={18} />}
              </div>
              <div className="text-left">
                <div className="text-xs sm:text-sm font-bold text-[var(--pitch)] leading-snug">
                  {showForm ? 'Close Form' : 'New Tip Post'}
                </div>
                <div className="text-[11px] text-[var(--pitch)]/75">
                  {showForm ? 'Cancel editing' : 'Create manually'}
                </div>
              </div>
            </div>
            <ChevronRight size={16} className="text-[var(--pitch)]/70 group-hover:text-[var(--pitch)] transition-colors" />
          </button>
        </div>
      </div>

      {/* New Post Form with Image Upload Section */}
      {showForm && (
        <form onSubmit={createPost} className="card p-4 sm:p-6 space-y-5 border border-[var(--floodlight)]/30">
          <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
            <Sparkles size={18} className="text-[var(--floodlight)]" />
            <span>Compose Matchday Prediction Post</span>
          </h2>

          <div className="field mb-0">
            <label htmlFor="title" className="text-xs text-[var(--chalk-muted)] font-semibold uppercase tracking-wider font-mono">
              Post Title
            </label>
            <input
              id="title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Saturday European Big 5 Banker"
              className="w-full text-sm font-medium"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="field mb-0">
              <label htmlFor="scheduledAt" className="text-xs text-[var(--chalk-muted)] font-semibold uppercase tracking-wider font-mono">
                Scheduled Match Time
              </label>
              <input
                id="scheduledAt"
                type="datetime-local"
                required
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full text-sm"
              />
            </div>
            <div className="field mb-0">
              <label htmlFor="bookingCode" className="text-xs text-[var(--chalk-muted)] font-semibold uppercase tracking-wider font-mono">
                Betting Booking Code
              </label>
              <input
                id="bookingCode"
                required
                value={bookingCode}
                onChange={(e) => setBookingCode(e.target.value)}
                placeholder="e.g. BC-98342 or SportyBet code"
                className="w-full font-mono uppercase text-sm"
              />
            </div>
          </div>

          <div className="field mb-0">
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
          </div>

          {/* Upload Prediction as Image Section */}
          <div className="p-4 rounded-xl bg-[var(--pitch)] border border-dashed border-[rgba(243,245,236,0.2)] space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-white uppercase tracking-wider font-mono flex items-center gap-1.5">
                <ImageIcon size={14} className="text-[var(--floodlight)]" />
                <span>Upload Prediction Slip Images ({selectedFiles.length}/10)</span>
              </label>
              <span className="text-[11px] text-[var(--chalk-muted)]">JPG, PNG (Max 5MB each)</span>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="btn btn-ghost text-xs py-2 px-4 w-full sm:w-auto inline-flex items-center justify-center gap-2 border-[rgba(243,245,236,0.18)]"
              >
                <FileImage size={15} className="text-[var(--floodlight)]" />
                <span>Attach Slip Screenshots</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/jpg"
                onChange={handleFileSelection}
                className="hidden"
              />
              <p className="text-xs text-[var(--chalk-muted)]">
                Attach original betslip screenshots for subscribers to view.
              </p>
            </div>

            {/* Selected File Previews */}
            {selectedFiles.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                {selectedFiles.map((file, idx) => (
                  <div
                    key={idx}
                    className="relative group rounded-lg overflow-hidden border border-[rgba(243,245,236,0.15)] bg-black/40 aspect-video flex items-center justify-center"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={filePreviews[idx]}
                      alt={file.name}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 p-2">
                      <span className="text-[10px] text-white font-mono truncate max-w-full">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => removeSelectedFile(idx)}
                        className="p-1 rounded bg-red-500/80 text-white hover:bg-red-600 transition-colors"
                        title="Remove image"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
                className="text-xs text-[var(--floodlight)] hover:underline inline-flex items-center gap-1 font-medium"
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

          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
              <ShieldAlert size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {uploadStatus && (
            <div className="text-xs font-mono text-[var(--floodlight)] flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[var(--floodlight)] animate-ping" />
              <span>{uploadStatus}</span>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              className="btn btn-primary py-2.5 px-6 text-sm font-bold"
              disabled={saving}
            >
              {saving ? 'Saving Post & Media…' : 'Save as Draft'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setSelectedFiles([]);
                setFilePreviews([]);
              }}
              className="btn btn-ghost py-2.5 px-4 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Predictions Feed Archive Card with Empty State styled matching the uploaded image */}
      <div className="card p-5 sm:p-7">
        {loading ? (
          <div className="p-12 text-center text-sm text-[var(--chalk-muted)]">
            Loading match posts…
          </div>
        ) : posts.length === 0 ? (
          /* Empty State styled exactly like the screenshot */
          <div className="py-12 px-4 text-center border border-dashed border-[rgba(243,245,236,0.14)] rounded-2xl flex flex-col items-center justify-center">
            {/* Tactics clipboard graphic icon */}
            <div className="w-20 h-20 mb-5 relative flex items-center justify-center">
              <svg className="w-full h-full text-emerald-500" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* Clipboard Outline */}
                <rect x="25" y="20" width="50" height="68" rx="8" stroke="#10b981" strokeWidth="2.5" fill="#0c2317" />
                <path d="M40 20V15C40 13.3431 41.3431 12 43 12H57C58.6569 12 60 13.3431 60 15V20" stroke="#10b981" strokeWidth="2.5" />
                {/* X and O tactics pattern */}
                <path d="M36 36L46 46M46 36L36 46" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" />
                <circle cx="62" cy="58" r="5" stroke="#10b981" strokeWidth="2.5" />
                <path d="M38 60L46 54" stroke="#10b981" strokeWidth="2" strokeDasharray="2 2" />
                {/* Football icon at bottom right */}
                <circle cx="68" cy="72" r="14" fill="#081910" stroke="#10b981" strokeWidth="2.5" />
                <circle cx="68" cy="72" r="5" fill="#10b981" />
              </svg>
              {/* Sparkle accents */}
              <div className="absolute -top-1 left-4 text-amber-400 text-xs font-bold">✦</div>
              <div className="absolute top-8 -right-2 text-amber-400 text-xs font-bold">✦</div>
              <div className="absolute bottom-4 left-2 text-amber-400 text-[10px]">✦</div>
            </div>

            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              Feed Archive ({posts.length}) • Live Tips Repository
            </h2>
            <div className="w-12 h-1 bg-amber-400 rounded-full my-3" />

            <p className="text-sm text-[var(--chalk-muted)] font-medium max-w-md mx-auto leading-relaxed mt-2">
              No match predictions created yet.
            </p>
            <p className="text-xs text-[var(--chalk-muted)]/80 max-w-sm mx-auto mt-1">
              Click &quot;New Tip Post&quot; or import a CSV slip to publish your first match predictions.
            </p>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-[rgba(243,245,236,0.1)]">
              <h2 className="text-lg font-bold text-white">
                Feed Archive ({posts.length})
              </h2>
              <span className="text-xs text-[var(--chalk-muted)] font-mono">
                Live Tips Repository
              </span>
            </div>

            <div className="space-y-3">
              {posts.map((p) => (
                <div
                  key={p.id}
                  className="p-4 rounded-xl bg-[var(--pitch)] border border-[rgba(243,245,236,0.1)] hover:border-[rgba(243,245,236,0.2)] transition-colors flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-bold text-base text-white">{p.title}</span>
                      <span
                        className={`px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider rounded-full ${
                          p.status === 'published'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {p.status}
                      </span>
                      {p.media && p.media.length > 0 && (
                        <span className="px-2 py-0.5 text-[10px] font-mono font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 rounded flex items-center gap-1">
                          <ImageIcon size={11} />
                          <span>{p.media.length} screenshot{p.media.length > 1 ? 's' : ''}</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-xs text-[var(--chalk-muted)] flex-wrap font-mono">
                      <span className="flex items-center gap-1">
                        <Calendar size={13} className="text-[var(--floodlight)]" />
                        {new Date(p.scheduledAt).toLocaleString()}
                      </span>
                      <span>•</span>
                      <span className="text-[var(--floodlight)] font-bold">Booking Code: {p.bookingCode}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    <Link
                      href={`/admin/predictions/${p.id}`}
                      className="btn btn-ghost text-xs py-2 px-3 inline-flex items-center gap-1.5 border-[rgba(243,245,236,0.1)]"
                    >
                      <Edit size={13} />
                      <span>Edit Post & Slip</span>
                    </Link>
                    {p.status !== 'published' && (
                      <button
                        onClick={() => publish(p.id)}
                        className="btn btn-primary text-xs py-2 px-3 inline-flex items-center gap-1.5"
                      >
                        <CheckCircle2 size={13} />
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
    </div>
  );
}
