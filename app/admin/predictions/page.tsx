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
    <div className="admin-dash-wrap">
      {/* Title & Supertitle Header */}
      <header className="admin-dash-header space-y-1">
        <h1 className="admin-dash-title">Predictions & Match Tips</h1>
        <p className="text-sm text-[#85a694] mt-1 font-medium">
          Publish match slips, booking codes, and scheduled betting insights.
        </p>
      </header>

      {/* Action Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mt-2">
        <Link
          href="/admin/predictions/csv"
          className="flex items-center justify-between p-4 rounded-2xl bg-[#102e20] border border-[rgba(243,245,236,0.14)] hover:border-[rgba(243,245,236,0.3)] transition-all group shadow-sm"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
              <Upload size={20} />
            </div>
            <div>
              <div className="text-base font-bold text-white leading-snug">Import CSV</div>
              <div className="text-xs text-[#85a694] font-medium">Bulk upload tips</div>
            </div>
          </div>
          <ChevronRight size={18} className="text-[#85a694] group-hover:text-white transition-colors" />
        </Link>

        <button
          onClick={() => setShowForm((s) => !s)}
          className="flex items-center justify-between p-4 rounded-2xl bg-[#f5b335] text-[#0a2116] font-bold transition-all hover:bg-[#f3bc20] group shadow-md text-left"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-[#0a2116] text-[#f5b335] flex items-center justify-center shrink-0">
              {showForm ? <X size={20} /> : <Plus size={20} />}
            </div>
            <div>
              <div className="text-base font-bold text-[#0a2116] leading-snug">
                {showForm ? 'Close Form' : 'New Tip Post'}
              </div>
              <div className="text-xs text-[#0a2116]/80 font-semibold">
                {showForm ? 'Cancel editing' : 'Create manually'}
              </div>
            </div>
          </div>
          <ChevronRight size={18} className="text-[#0a2116]/70 group-hover:text-[#0a2116] transition-colors" />
        </button>
      </div>

      {/* New Post Form with Image Upload Section */}
      {showForm && (
        <form onSubmit={createPost} className="p-5 sm:p-7 rounded-2xl bg-[#102e20] border border-[#f5b335]/40 space-y-5 shadow-lg">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Sparkles size={20} className="text-[#f5b335]" />
            <span>Compose Matchday Prediction Post</span>
          </h2>

          <div className="field mb-0">
            <label htmlFor="title" className="text-xs text-[#85a694] font-semibold uppercase tracking-wider font-mono">
              Post Title
            </label>
            <input
              id="title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Saturday European Big 5 Banker"
              className="w-full text-sm font-medium bg-[#0b2216] border border-[rgba(243,245,236,0.14)] rounded-xl p-3 text-white focus:border-[#f5b335]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="field mb-0">
              <label htmlFor="scheduledAt" className="text-xs text-[#85a694] font-semibold uppercase tracking-wider font-mono">
                Scheduled Match Time
              </label>
              <input
                id="scheduledAt"
                type="datetime-local"
                required
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full text-sm bg-[#0b2216] border border-[rgba(243,245,236,0.14)] rounded-xl p-3 text-white focus:border-[#f5b335]"
              />
            </div>
            <div className="field mb-0">
              <label htmlFor="bookingCode" className="text-xs text-[#85a694] font-semibold uppercase tracking-wider font-mono">
                Betting Booking Code
              </label>
              <input
                id="bookingCode"
                required
                value={bookingCode}
                onChange={(e) => setBookingCode(e.target.value)}
                placeholder="e.g. BC-98342 or SportyBet code"
                className="w-full font-mono uppercase text-sm bg-[#0b2216] border border-[rgba(243,245,236,0.14)] rounded-xl p-3 text-white focus:border-[#f5b335]"
              />
            </div>
          </div>

          <div className="field mb-0">
            <label htmlFor="visibility" className="text-xs text-[#85a694] font-semibold uppercase tracking-wider font-mono">
              Subscriber Visibility
            </label>
            <select
              id="visibility"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as any)}
              className="w-full bg-[#0b2216] border border-[rgba(243,245,236,0.14)] rounded-xl p-3 text-sm text-white focus:border-[#f5b335]"
            >
              <option value="subscribers">All Active Subscribers</option>
              <option value="plan_specific">Plan-Specific VIPs</option>
              <option value="free_window">Free Window (Promotional)</option>
            </select>
          </div>

          {/* Upload Prediction as Image Section */}
          <div className="p-4 rounded-xl bg-[#0b2216] border border-dashed border-[rgba(243,245,236,0.2)] space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-white uppercase tracking-wider font-mono flex items-center gap-1.5">
                <ImageIcon size={14} className="text-[#f5b335]" />
                <span>Upload Prediction Slip Images ({selectedFiles.length}/10)</span>
              </label>
              <span className="text-[11px] text-[#85a694]">JPG, PNG (Max 5MB each)</span>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="btn btn-ghost text-xs py-2 px-4 w-full sm:w-auto inline-flex items-center justify-center gap-2 border-[rgba(243,245,236,0.2)] text-white hover:border-[#f5b335]"
              >
                <FileImage size={15} className="text-[#f5b335]" />
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
              <p className="text-xs text-[#85a694]">
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
                className="text-xs text-[#f5b335] hover:underline inline-flex items-center gap-1 font-medium"
              >
                <Plus size={12} />
                <span>Add Another Match</span>
              </button>
            </div>

            {items.map((item, i) => (
              <div
                key={i}
                className="p-3 rounded-xl bg-[#0b2216] border border-[rgba(243,245,236,0.1)] flex flex-col sm:flex-row gap-2 items-stretch sm:items-center"
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
                    className="w-full text-xs sm:text-sm bg-transparent border-0 p-1 text-[#f5b335] font-mono focus:ring-0"
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
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
              <ShieldAlert size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {uploadStatus && (
            <div className="text-xs font-mono text-[#f5b335] flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#f5b335] animate-ping" />
              <span>{uploadStatus}</span>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              className="btn btn-primary py-2.5 px-6 text-sm font-bold bg-[#f5b335] text-[#0a2116] hover:bg-[#f3bc20]"
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
              className="btn btn-ghost py-2.5 px-4 text-sm text-[#85a694] border-[rgba(243,245,236,0.14)]"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Predictions Feed Archive Card */}
      <div className="p-6 sm:p-8 rounded-2xl bg-[#102e20] border border-[rgba(243,245,236,0.14)] shadow-md">
        {loading ? (
          <div className="p-12 text-center text-sm text-[#85a694] font-medium">
            Loading match posts…
          </div>
        ) : posts.length === 0 ? (
          /* Empty State matching image specification */
          <div className="py-12 px-4 text-center border border-dashed border-[rgba(243,245,236,0.16)] rounded-2xl flex flex-col items-center justify-center bg-[#0b2216]/50">
            {/* Tactics clipboard graphic icon with sparkle stars */}
            <div className="relative w-28 h-28 mx-auto mb-4 flex items-center justify-center">
              {/* Sparkle accents */}
              <span className="absolute -top-1 left-3 text-amber-400 text-base select-none">✦</span>
              <span className="absolute top-2 right-1 text-amber-400 text-lg select-none">✦</span>
              <span className="absolute bottom-6 left-0 text-amber-400 text-sm select-none">✦</span>
              <span className="absolute bottom-1 right-2 text-amber-400 text-sm select-none">✦</span>

              <svg className="w-24 h-24 text-emerald-500" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* Clipboard Outline & Fill */}
                <rect x="26" y="18" width="48" height="66" rx="8" stroke="#10b981" strokeWidth="2.5" fill="#0c2518" />
                {/* Top Clip */}
                <path d="M41 18V13C41 11.8954 41.8954 11 43 11H57C58.1046 11 59 11.8954 59 13V18" stroke="#10b981" strokeWidth="2.5" fill="#081a10" />
                <circle cx="50" cy="15" r="1.5" fill="#10b981" />

                {/* X and O tactics pattern */}
                <path d="M35 34L43 42M43 34L35 42" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" />
                <circle cx="58" cy="38" r="4.5" stroke="#10b981" strokeWidth="2.5" />
                <path d="M37 58L47 48" stroke="#10b981" strokeWidth="2" strokeDasharray="3 2" />
                <path d="M43 48H47V52" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M35 64L43 72M43 64L35 72" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" />

                {/* Football icon at bottom right */}
                <circle cx="66" cy="68" r="13" fill="#081a10" stroke="#10b981" strokeWidth="2.5" />
                <path d="M66 59L70 62V66L66 69L62 66V62L66 59Z" fill="#10b981" />
                <path d="M66 59V55M70 62L74 60M70 66L74 69M66 69V73M62 66L58 69M62 62L58 60" stroke="#10b981" strokeWidth="1.5" />
              </svg>
            </div>

            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              Feed Archive ({posts.length}) • Live Tips Repository
            </h2>
            <div className="w-12 h-1 bg-[#f5b335] rounded-full my-3" />

            <p className="text-sm text-[#85a694] font-medium max-w-md mx-auto leading-relaxed mt-2">
              No match predictions created yet.
            </p>
            <p className="text-xs text-[#85a694]/80 max-w-sm mx-auto mt-1">
              Click &quot;New Tip Post&quot; or import a CSV slip to publish your first match predictions.
            </p>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-[rgba(243,245,236,0.12)]">
              <h2 className="text-lg font-bold text-white">
                Feed Archive ({posts.length}) • Live Tips Repository
              </h2>
            </div>

            <div className="space-y-3">
              {posts.map((p) => (
                <div
                  key={p.id}
                  className="p-4 rounded-xl bg-[#0b2216] border border-[rgba(243,245,236,0.12)] hover:border-[rgba(243,245,236,0.25)] transition-colors flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
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

                    <div className="flex items-center gap-3 text-xs text-[#85a694] flex-wrap font-mono">
                      <span className="flex items-center gap-1">
                        <Calendar size={13} className="text-[#f5b335]" />
                        {new Date(p.scheduledAt).toLocaleString()}
                      </span>
                      <span>•</span>
                      <span className="text-[#f5b335] font-bold">Booking Code: {p.bookingCode}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    <Link
                      href={`/admin/predictions/${p.id}`}
                      className="btn btn-ghost text-xs py-2 px-3 inline-flex items-center gap-1.5 border-[rgba(243,245,236,0.14)] text-white hover:border-[#f5b335]"
                    >
                      <Edit size={13} />
                      <span>Edit Post & Slip</span>
                    </Link>
                    {p.status !== 'published' && (
                      <button
                        onClick={() => publish(p.id)}
                        className="btn btn-primary text-xs py-2 px-3 inline-flex items-center gap-1.5 bg-[#f5b335] text-[#0a2116] hover:bg-[#f3bc20]"
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
