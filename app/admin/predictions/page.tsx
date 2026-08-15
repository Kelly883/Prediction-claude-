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
  Layers,
  FileCheck,
  Zap,
  Eye,
  Info,
  Clock,
  ExternalLink,
} from 'lucide-react';

type MediaAsset = { id: string; storageKey: string };
type PostItem = { id?: string; match: string; prediction: string };
type Post = {
  id: string;
  title: string;
  status: string;
  scheduledAt: string;
  bookingCode: string;
  visibility: 'plan_specific' | 'subscribers' | 'free_window';
  items?: PostItem[];
  media?: MediaAsset[];
};

const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/jpg'];

const emptyItem = () => ({ match: '', prediction: '' });

export default function AdminPredictionsPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  // UI Tabs & Toggles
  const [activeTab, setActiveTab] = useState<'all' | 'published' | 'draft'>('all');
  const [showManualForm, setShowManualForm] = useState(false);
  const [showImageUploadSection, setShowImageUploadSection] = useState(false);

  // Quick Image Upload Form fields
  const [imgTitle, setImgTitle] = useState('');
  const [imgBookingCode, setImgBookingCode] = useState('');
  const [imgScheduledAt, setImgScheduledAt] = useState('');
  const [imgVisibility, setImgVisibility] = useState<'plan_specific' | 'subscribers' | 'free_window'>('subscribers');
  const [imgAutoPublish, setImgAutoPublish] = useState(true);
  const [imgFiles, setImgFiles] = useState<File[]>([]);
  const [imgPreviews, setImgPreviews] = useState<string[]>([]);
  const imgFileInputRef = useRef<HTMLInputElement>(null);
  const [imgUploading, setImgUploading] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);

  // Manual Form fields
  const [title, setTitle] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [bookingCode, setBookingCode] = useState('');
  const [visibility, setVisibility] = useState<'plan_specific' | 'subscribers' | 'free_window'>('subscribers');
  const [items, setItems] = useState([emptyItem()]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<string[]>([]);
  const manualFileInputRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  // Lightbox preview modal state
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

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
      imgPreviews.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [filePreviews, imgPreviews]);

  // Image validation helper
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

  // Handle Quick Image Upload files selection
  function handleQuickImageSelection(filesList: FileList | File[] | null) {
    setImgError(null);
    if (!filesList) return;
    const files = Array.from(filesList);
    if (!files.length) return;

    const { valid, error: valErr } = validateFiles(files, imgFiles.length);
    if (valErr) {
      setImgError(valErr);
      if (!valid.length) return;
    }

    const newPreviews = valid.map((f) => URL.createObjectURL(f));
    setImgFiles((prev) => [...prev, ...valid]);
    setImgPreviews((prev) => [...prev, ...newPreviews]);

    // Auto set a default title if empty
    if (!imgTitle) {
      const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      setImgTitle(`Prediction Slip — ${todayStr}`);
    }
    // Auto set scheduledAt default to current time
    if (!imgScheduledAt) {
      const now = new Date();
      now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
      setImgScheduledAt(now.toISOString().slice(0, 16));
    }

    if (imgFileInputRef.current) imgFileInputRef.current.value = '';
  }

  function removeQuickImageFile(index: number) {
    URL.revokeObjectURL(imgPreviews[index]);
    setImgFiles((prev) => prev.filter((_, i) => i !== index));
    setImgPreviews((prev) => prev.filter((_, i) => i !== index));
  }

  // Direct "Upload Prediction as Image" submission
  async function submitQuickImageUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!imgFiles.length) {
      setImgError('Please select at least one prediction slip image.');
      return;
    }
    setImgUploading(true);
    setImgError(null);

    try {
      // Step 1: Create prediction post draft
      const postTitle = imgTitle.trim() || `Prediction Slip ${new Date().toLocaleDateString()}`;
      const postScheduled = imgScheduledAt ? new Date(imgScheduledAt).toISOString() : new Date().toISOString();

      const newPost = await apiJson<Post>('/api/admin/predictions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: postTitle,
          scheduledAt: postScheduled,
          bookingCode: imgBookingCode.trim() || 'SLIP-IMAGE',
          visibility: imgVisibility,
          items: [{ match: 'See attached prediction slip screenshot', prediction: 'Slip Image' }],
        }),
      });

      // Step 2: Upload images
      for (let i = 0; i < imgFiles.length; i++) {
        const file = imgFiles[i];
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

      // Step 3: Publish if auto-publish checked
      if (imgAutoPublish) {
        await apiJson(`/api/admin/predictions/${newPost.id}/publish`, { method: 'POST' });
      }

      // Reset image upload form
      setImgTitle('');
      setImgBookingCode('');
      setImgScheduledAt('');
      setImgFiles([]);
      setImgPreviews([]);
      setShowImageUploadSection(false);
      load();
    } catch (err) {
      setImgError((err as Error).message);
    } finally {
      setImgUploading(false);
    }
  }

  // Handle Manual Form image selection
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

  // Manual Form creation
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

  // Computed metrics
  const totalPosts = posts.length;
  const publishedPosts = posts.filter((p) => p.status === 'published').length;
  const draftPosts = posts.filter((p) => p.status !== 'published').length;
  const postsWithImages = posts.filter((p) => p.media && p.media.length > 0).length;

  const filteredPosts = posts.filter((p) => {
    if (activeTab === 'published') return p.status === 'published';
    if (activeTab === 'draft') return p.status !== 'published';
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 pb-2">
        <div>
          <h1 className="font-bold text-2xl sm:text-3xl text-white tracking-tight flex items-center gap-2.5">
            <span>Predictions & Match Tips</span>
          </h1>
          <p className="text-xs sm:text-sm text-[var(--chalk-muted)] mt-1">
            Publish match slips, image predictions, booking codes, and scheduled betting insights.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-1 sm:flex sm:items-center gap-2.5">
          <button
            onClick={() => {
              setShowImageUploadSection((s) => !s);
              if (showManualForm) setShowManualForm(false);
            }}
            className={`flex items-center justify-between gap-3 p-3 rounded-xl border transition-all text-left ${
              showImageUploadSection
                ? 'bg-emerald-500/20 border-emerald-500/50 text-white'
                : 'bg-[var(--pitch)] border-[rgba(243,245,236,0.14)] hover:border-emerald-500/40 text-white'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                <FileImage size={18} />
              </div>
              <div>
                <div className="text-xs sm:text-sm font-bold leading-snug">
                  {showImageUploadSection ? 'Hide Image Upload' : 'Upload Image Slip'}
                </div>
                <div className="text-[11px] text-[var(--chalk-muted)]">
                  Instant prediction upload
                </div>
              </div>
            </div>
          </button>

          <Link
            href="/admin/predictions/csv"
            className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[var(--pitch)] border border-[rgba(243,245,236,0.14)] hover:border-amber-500/40 transition-all text-left text-white"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                <Upload size={18} />
              </div>
              <div>
                <div className="text-xs sm:text-sm font-bold leading-snug">Import CSV</div>
                <div className="text-[11px] text-[var(--chalk-muted)]">Bulk upload tips</div>
              </div>
            </div>
          </Link>

          <button
            onClick={() => {
              setShowManualForm((s) => !s);
              if (showImageUploadSection) setShowImageUploadSection(false);
            }}
            className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[var(--floodlight)] text-[var(--pitch)] font-bold transition-all hover:bg-[#f3bc20]"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[var(--pitch)] text-[var(--floodlight)] flex items-center justify-center shrink-0">
                {showManualForm ? <X size={18} /> : <Plus size={18} />}
              </div>
              <div>
                <div className="text-xs sm:text-sm font-bold leading-snug">
                  {showManualForm ? 'Close Form' : 'New Tip Post'}
                </div>
                <div className="text-[11px] text-[var(--pitch)]/75">
                  {showManualForm ? 'Cancel editing' : 'Create manually'}
                </div>
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Summary Metrics Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card p-3.5 sm:p-4 bg-[var(--pitch)] border border-[rgba(243,245,236,0.1)] flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
            <Layers size={20} />
          </div>
          <div>
            <div className="text-xl font-extrabold text-white leading-tight">{totalPosts}</div>
            <div className="text-[11px] text-[var(--chalk-muted)] font-medium">Total Predictions</div>
          </div>
        </div>

        <div className="card p-3.5 sm:p-4 bg-[var(--pitch)] border border-[rgba(243,245,236,0.1)] flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
            <FileCheck size={20} />
          </div>
          <div>
            <div className="text-xl font-extrabold text-emerald-400 leading-tight">{publishedPosts}</div>
            <div className="text-[11px] text-[var(--chalk-muted)] font-medium">Published Live</div>
          </div>
        </div>

        <div className="card p-3.5 sm:p-4 bg-[var(--pitch)] border border-[rgba(243,245,236,0.1)] flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
            <Clock size={20} />
          </div>
          <div>
            <div className="text-xl font-extrabold text-amber-300 leading-tight">{draftPosts}</div>
            <div className="text-[11px] text-[var(--chalk-muted)] font-medium">Drafts Pending</div>
          </div>
        </div>

        <div className="card p-3.5 sm:p-4 bg-[var(--pitch)] border border-[rgba(243,245,236,0.1)] flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center shrink-0">
            <ImageIcon size={20} />
          </div>
          <div>
            <div className="text-xl font-extrabold text-purple-300 leading-tight">{postsWithImages}</div>
            <div className="text-[11px] text-[var(--chalk-muted)] font-medium">Image Slip Posts</div>
          </div>
        </div>
      </div>

      {/* DEDICATED SECTION: Upload Prediction as Image */}
      {showImageUploadSection && (
        <form
          onSubmit={submitQuickImageUpload}
          className="card p-5 sm:p-6 space-y-5 border-2 border-emerald-500/40 bg-gradient-to-b from-[#0c2317]/80 to-[var(--turf)]/90 shadow-xl"
        >
          <div className="flex items-center justify-between pb-3 border-b border-emerald-500/20">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <FileImage size={20} />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  Upload Prediction as Image
                </h2>
                <p className="text-xs text-[var(--chalk-muted)]">
                  Quickly upload original betslip screenshots for subscribers to view directly.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowImageUploadSection(false)}
              className="text-[var(--chalk-muted)] hover:text-white p-1 rounded-md"
            >
              <X size={18} />
            </button>
          </div>

          {/* Drag & Drop Upload Dropzone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handleQuickImageSelection(e.dataTransfer.files);
            }}
            onClick={() => imgFileInputRef.current?.click()}
            className="border-2 border-dashed border-emerald-500/30 hover:border-emerald-400 bg-[var(--pitch)]/60 hover:bg-[var(--pitch)] p-6 sm:p-8 rounded-2xl text-center cursor-pointer transition-all space-y-3 group"
          >
            <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center group-hover:scale-105 transition-transform">
              <Upload size={28} />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">
                Drag & drop prediction slip images here, or <span className="text-emerald-400 underline">browse</span>
              </p>
              <p className="text-xs text-[var(--chalk-muted)] mt-1">
                Supports JPG & PNG up to 5MB each (Max 10 images)
              </p>
            </div>
            <input
              ref={imgFileInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/jpg"
              onChange={(e) => handleQuickImageSelection(e.target.files)}
              className="hidden"
            />
          </div>

          {/* Image Previews Grid */}
          {imgFiles.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-emerald-300">
                <span>Selected Slip Screenshots ({imgFiles.length})</span>
                <button
                  type="button"
                  onClick={() => {
                    imgPreviews.forEach((u) => URL.revokeObjectURL(u));
                    setImgFiles([]);
                    setImgPreviews([]);
                  }}
                  className="text-red-400 hover:underline text-[11px]"
                >
                  Clear all
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {imgFiles.map((file, idx) => (
                  <div
                    key={idx}
                    className="relative group rounded-xl overflow-hidden border border-emerald-500/30 bg-black/60 aspect-video flex items-center justify-center"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imgPreviews[idx]}
                      alt={file.name}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/75 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
                      <span className="text-[10px] text-white font-mono truncate max-w-full px-1">{file.name}</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setPreviewImageUrl(imgPreviews[idx])}
                          className="p-1.5 rounded-lg bg-blue-500/80 text-white hover:bg-blue-600 transition-colors"
                          title="Preview Fullscreen"
                        >
                          <Eye size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeQuickImageFile(idx)}
                          className="p-1.5 rounded-lg bg-red-500/80 text-white hover:bg-red-600 transition-colors"
                          title="Remove image"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Optional Meta Information Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-[rgba(243,245,236,0.1)]">
            <div className="field mb-0">
              <label htmlFor="imgTitle" className="text-xs text-[var(--chalk-muted)] font-semibold uppercase tracking-wider font-mono">
                Post Title
              </label>
              <input
                id="imgTitle"
                value={imgTitle}
                onChange={(e) => setImgTitle(e.target.value)}
                placeholder="e.g. Saturday VIP Slip Screenshot"
                className="w-full text-sm font-medium"
              />
            </div>

            <div className="field mb-0">
              <label htmlFor="imgBookingCode" className="text-xs text-[var(--chalk-muted)] font-semibold uppercase tracking-wider font-mono">
                Booking Code (Optional)
              </label>
              <input
                id="imgBookingCode"
                value={imgBookingCode}
                onChange={(e) => setImgBookingCode(e.target.value)}
                placeholder="e.g. SportyBet Code BC-9912"
                className="w-full text-sm font-mono uppercase"
              />
            </div>

            <div className="field mb-0">
              <label htmlFor="imgScheduledAt" className="text-xs text-[var(--chalk-muted)] font-semibold uppercase tracking-wider font-mono">
                Scheduled Match Time
              </label>
              <input
                id="imgScheduledAt"
                type="datetime-local"
                value={imgScheduledAt}
                onChange={(e) => setImgScheduledAt(e.target.value)}
                className="w-full text-sm"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-white cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={imgAutoPublish}
                  onChange={(e) => setImgAutoPublish(e.target.checked)}
                  className="rounded border-[rgba(243,245,236,0.2)] bg-[var(--pitch)] text-emerald-400 focus:ring-emerald-400"
                />
                <span className="font-semibold text-emerald-300">Publish Live Immediately</span>
              </label>

              <div className="flex items-center gap-1.5 text-xs text-[var(--chalk-muted)]">
                <span>Visibility:</span>
                <select
                  value={imgVisibility}
                  onChange={(e) => setImgVisibility(e.target.value as any)}
                  className="bg-[var(--pitch)] border border-[rgba(243,245,236,0.15)] rounded px-2 py-1 text-xs text-white"
                >
                  <option value="subscribers">Subscribers</option>
                  <option value="plan_specific">Plan VIPs</option>
                  <option value="free_window">Free Window</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setShowImageUploadSection(false)}
                className="btn btn-ghost py-2.5 px-4 text-xs w-1/2 sm:w-auto"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={imgUploading || !imgFiles.length}
                className="btn btn-primary py-2.5 px-6 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-black w-1/2 sm:w-auto inline-flex items-center justify-center gap-2"
              >
                <Zap size={14} />
                <span>{imgUploading ? 'Uploading Image Slip…' : 'Upload & Publish Slip'}</span>
              </button>
            </div>
          </div>

          {imgError && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
              <ShieldAlert size={16} className="shrink-0" />
              <span>{imgError}</span>
            </div>
          )}
        </form>
      )}

      {/* Manual Compose Form */}
      {showManualForm && (
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

          {/* Attach Prediction Slip Images */}
          <div className="p-4 rounded-xl bg-[var(--pitch)] border border-dashed border-[rgba(243,245,236,0.2)] space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-white uppercase tracking-wider font-mono flex items-center gap-1.5">
                <ImageIcon size={14} className="text-[var(--floodlight)]" />
                <span>Attach Slip Screenshots ({selectedFiles.length}/10)</span>
              </label>
              <span className="text-[11px] text-[var(--chalk-muted)]">JPG, PNG (Max 5MB each)</span>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3">
              <button
                type="button"
                onClick={() => manualFileInputRef.current?.click()}
                className="btn btn-ghost text-xs py-2 px-4 w-full sm:w-auto inline-flex items-center justify-center gap-2 border-[rgba(243,245,236,0.18)]"
              >
                <FileImage size={15} className="text-[var(--floodlight)]" />
                <span>Attach Slip Screenshots</span>
              </button>
              <input
                ref={manualFileInputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/jpg"
                onChange={handleFileSelection}
                className="hidden"
              />
              <p className="text-xs text-[var(--chalk-muted)]">
                Attach betslip screenshots for subscribers to view.
              </p>
            </div>

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
                setShowManualForm(false);
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

      {/* Feed Archive & Tab Filtering Card */}
      <div className="card p-5 sm:p-7 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-[rgba(243,245,236,0.1)]">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span>Feed Archive ({filteredPosts.length})</span>
            </h2>
            <p className="text-xs text-[var(--chalk-muted)]">Live Tips Repository & Published Slips</p>
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-1 bg-[var(--pitch)] p-1 rounded-xl border border-[rgba(243,245,236,0.1)] self-start sm:self-auto">
            <button
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                activeTab === 'all'
                  ? 'bg-[var(--turf)] text-white shadow'
                  : 'text-[var(--chalk-muted)] hover:text-white'
              }`}
            >
              All ({posts.length})
            </button>
            <button
              onClick={() => setActiveTab('published')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                activeTab === 'published'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'text-[var(--chalk-muted)] hover:text-white'
              }`}
            >
              Published ({publishedPosts})
            </button>
            <button
              onClick={() => setActiveTab('draft')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                activeTab === 'draft'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'text-[var(--chalk-muted)] hover:text-white'
              }`}
            >
              Drafts ({draftPosts})
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-sm text-[var(--chalk-muted)] font-mono animate-pulse">
            Loading match posts…
          </div>
        ) : filteredPosts.length === 0 ? (
          /* Empty State styled exactly matching original artwork */
          <div className="py-12 px-4 text-center border border-dashed border-[rgba(243,245,236,0.14)] rounded-2xl flex flex-col items-center justify-center">
            <div className="w-20 h-20 mb-5 relative flex items-center justify-center">
              <svg className="w-full h-full text-emerald-500" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="25" y="20" width="50" height="68" rx="8" stroke="#10b981" strokeWidth="2.5" fill="#0c2317" />
                <path d="M40 20V15C40 13.3431 41.3431 12 43 12H57C58.6569 12 60 13.3431 60 15V20" stroke="#10b981" strokeWidth="2.5" />
                <path d="M36 36L46 46M46 36L36 46" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" />
                <circle cx="62" cy="58" r="5" stroke="#10b981" strokeWidth="2.5" />
                <path d="M38 60L46 54" stroke="#10b981" strokeWidth="2" strokeDasharray="2 2" />
                <circle cx="68" cy="72" r="14" fill="#081910" stroke="#10b981" strokeWidth="2.5" />
                <circle cx="68" cy="72" r="5" fill="#10b981" />
              </svg>
              <div className="absolute -top-1 left-4 text-amber-400 text-xs font-bold">✦</div>
              <div className="absolute top-8 -right-2 text-amber-400 text-xs font-bold">✦</div>
              <div className="absolute bottom-4 left-2 text-amber-400 text-[10px]">✦</div>
            </div>

            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              Feed Archive ({filteredPosts.length}) • Live Tips Repository
            </h2>
            <div className="w-12 h-1 bg-amber-400 rounded-full my-3" />

            <p className="text-sm text-[var(--chalk-muted)] font-medium max-w-md mx-auto leading-relaxed mt-2">
              No match predictions found in this category.
            </p>
            <p className="text-xs text-[var(--chalk-muted)]/80 max-w-sm mx-auto mt-1">
              Click &quot;Upload Image Slip&quot;, &quot;New Tip Post&quot;, or import a CSV slip to publish your match predictions.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredPosts.map((p) => (
              <div
                key={p.id}
                className="p-4 rounded-xl bg-[var(--pitch)] border border-[rgba(243,245,236,0.1)] hover:border-[rgba(243,245,236,0.2)] transition-all flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 group"
              >
                <div className="space-y-2 min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="font-bold text-base text-white group-hover:text-[var(--floodlight)] transition-colors">
                      {p.title}
                    </span>

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
                      <span className="px-2 py-0.5 text-[10px] font-mono font-semibold bg-purple-500/15 text-purple-300 border border-purple-500/30 rounded-md flex items-center gap-1">
                        <ImageIcon size={11} />
                        <span>{p.media.length} slip image{p.media.length > 1 ? 's' : ''}</span>
                      </span>
                    )}

                    <span className="px-2 py-0.5 text-[10px] font-mono text-[var(--chalk-muted)] bg-zinc-800/80 rounded">
                      {p.visibility === 'subscribers'
                        ? 'All Active Subscribers'
                        : p.visibility === 'plan_specific'
                        ? 'VIP Plan Only'
                        : 'Free Window'}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-[var(--chalk-muted)] flex-wrap font-mono">
                    <span className="flex items-center gap-1">
                      <Calendar size={13} className="text-[var(--floodlight)]" />
                      {new Date(p.scheduledAt).toLocaleString()}
                    </span>
                    <span>•</span>
                    <span className="text-[var(--floodlight)] font-bold">Booking Code: {p.bookingCode}</span>
                    {p.items && p.items.length > 0 && (
                      <>
                        <span>•</span>
                        <span>{p.items.length} match pick{p.items.length > 1 ? 's' : ''}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                  <Link
                    href={`/admin/predictions/${p.id}`}
                    className="btn btn-ghost text-xs py-2 px-3 inline-flex items-center gap-1.5 border-[rgba(243,245,236,0.12)] hover:border-white/30"
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
        )}
      </div>

      {/* Lightbox Modal for Image Previews */}
      {previewImageUrl && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative max-w-4xl w-full max-h-[90vh] flex flex-col items-center">
            <button
              onClick={() => setPreviewImageUrl(null)}
              className="absolute -top-10 right-0 p-2 text-white/80 hover:text-white"
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
