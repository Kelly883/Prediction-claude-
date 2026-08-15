'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiJson, apiFetch } from '@/lib/api-client';

type Item = { id: string; match: string; prediction: string };
type MediaAsset = { id: string; storageKey: string; createdAt?: string };
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
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingMediaId, setDeletingMediaId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  async function processAndUploadFile(file: File) {
    if (!post) return;
    setUploadError(null);

    // 1. Frontend validation: JPG / PNG only
    const allowedMime = ['image/jpeg', 'image/png', 'image/jpg'];
    if (!allowedMime.includes(file.type.toLowerCase())) {
      setUploadError('Only JPG and PNG images are allowed.');
      return;
    }

    // 2. Frontend validation: 5 MB max
    const maxBytes = 5 * 1024 * 1024;
    if (file.size > maxBytes) {
      setUploadError('The image must be 5 MB or smaller.');
      return;
    }
    if (file.size === 0) {
      setUploadError('The selected file is empty.');
      return;
    }

    // Generate local preview
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    setUploading(true);
    setUploadProgress('Validating and optimizing image…');

    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await apiFetch(`/api/admin/predictions/${post.id}/images`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? 'The image could not be uploaded. Please try again.');
      }
      setUploadProgress('Image uploaded and secured successfully!');
      setTimeout(() => {
        setUploadProgress(null);
        setPreviewUrl(null);
      }, 1500);
      load();
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      processAndUploadFile(file);
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processAndUploadFile(file);
    }
  }

  async function handleDeleteImage(mediaId: string) {
    if (!post || !confirm('Are you sure you want to remove this prediction image?')) return;
    setDeletingMediaId(mediaId);
    try {
      const res = await apiFetch(`/api/admin/predictions/${post.id}/images/${mediaId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Failed to delete image.');
      }
      load();
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setDeletingMediaId(null);
    }
  }

  if (loading) {
    return <div className="container section">Loading…</div>;
  }

  if (!post) {
    return <div className="container section">Not found.</div>;
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        <h1 className="display" style={{ fontSize: 28 }}>Edit post</h1>
        <span style={{ fontSize: 13, textTransform: 'capitalize', color: post.status === 'published' ? 'var(--floodlight)' : 'var(--chalk-muted)' }}>
          {post.status}
        </span>
      </div>

      <div className="admin-grid-half">
        <div className="card">
          <div className="field">
            <label htmlFor="title">Title</label>
            <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="bookingCode">Booking code</label>
            <input id="bookingCode" value={bookingCode} onChange={(e) => setBookingCode(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="bodyNotes">Notes</label>
            <textarea
              id="bodyNotes"
              rows={4}
              value={bodyNotes}
              onChange={(e) => setBodyNotes(e.target.value)}
              style={{ background: 'var(--pitch)', border: '1px solid rgba(243,245,236,0.14)', borderRadius: 4, padding: '12px 14px', color: 'var(--chalk)', fontFamily: 'inherit', fontSize: 14 }}
            />
          </div>
          <div className="field">
            <label htmlFor="visibility">Visibility</label>
            <select
              id="visibility"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as any)}
              style={{ background: 'var(--pitch)', border: '1px solid rgba(243,245,236,0.14)', borderRadius: 4, padding: '12px 14px', color: 'var(--chalk)' }}
            >
              <option value="subscribers">All subscribers</option>
              <option value="plan_specific">Specific plans</option>
              <option value="free_window">Free window</option>
            </select>
          </div>
          {visibility === 'free_window' && (
            <div className="field">
              <label htmlFor="freeUntil">Free until</label>
              <input id="freeUntil" type="datetime-local" value={freeUntil} onChange={(e) => setFreeUntil(e.target.value)} />
            </div>
          )}

          {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <button onClick={save} className="btn btn-primary" disabled={saving || uploading}>{saving ? 'Saving…' : 'Save changes'}</button>
            {post.status !== 'published' && (
              <button onClick={publish} className="btn btn-ghost" disabled={saving || uploading}>Publish</button>
            )}
          </div>
          <button onClick={archive} className="btn btn-ghost" style={{ color: 'var(--card-red)', borderColor: 'var(--card-red)' }} disabled={saving || uploading}>
            Archive post
          </button>

          <h3 style={{ fontSize: 14, marginTop: 24, marginBottom: 8 }}>Matches</h3>
          {post.items.map((item) => (
            <div key={item.id} style={{ fontSize: 13, color: 'var(--chalk-muted)', padding: '4px 0' }}>
              {item.match} — <span className="mono">{item.prediction}</span>
            </div>
          ))}
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>Prediction Images</h2>
            <span style={{ fontSize: 12, color: 'var(--chalk-muted)' }}>{post.media.length}/10 uploaded</span>
          </div>

          <p style={{ fontSize: 12, color: 'var(--chalk-muted)', marginBottom: 16 }}>
            JPG or PNG only • Maximum 5 MB per image • Strips EXIF metadata &amp; validates server-side
          </p>

          {/* Drag & Drop Upload Zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: isDragging ? '2px dashed var(--floodlight, #F5B335)' : '2px dashed rgba(243,245,236,0.2)',
              background: isDragging ? 'rgba(245, 179, 53, 0.08)' : 'rgba(243, 245, 236, 0.02)',
              borderRadius: 8,
              padding: '24px 16px',
              textAlign: 'center',
              cursor: uploading ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
              marginBottom: 16,
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png"
              onChange={handleFileChange}
              disabled={uploading}
              style={{ display: 'none' }}
            />
            <div style={{ fontSize: 24, marginBottom: 8 }}>📷</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--chalk)' }}>
              {uploading ? 'Processing Image…' : 'Click or Drag image here'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--chalk-muted)', marginTop: 4 }}>
              Supports JPG &amp; PNG (up to 5 MB)
            </div>
          </div>

          {/* Local Preview / Upload Progress */}
          {previewUrl && (
            <div style={{ marginBottom: 16, padding: 12, background: 'var(--pitch)', borderRadius: 6, border: '1px solid rgba(243,245,236,0.1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <img
                  src={previewUrl}
                  alt="Upload preview"
                  style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4, border: '1px solid rgba(243,245,236,0.14)' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{uploadProgress ?? 'Uploading…'}</div>
                  {uploading && (
                    <div style={{ width: '100%', height: 4, background: 'rgba(243,245,236,0.1)', borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
                      <div style={{ width: '100%', height: '100%', background: 'var(--floodlight)', animation: 'pulse 1.5s infinite' }} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {uploadError && (
            <div className="error-text" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{uploadError}</span>
              <button
                type="button"
                onClick={() => setUploadError(null)}
                style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 14, padding: 0 }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Existing Images Gallery */}
          <div style={{ display: 'grid', gap: 10 }}>
            {post.media.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--chalk-muted)', textAlign: 'center', padding: '16px 0' }}>
                No prediction images attached to this post yet.
              </div>
            ) : (
              post.media.map((m) => {
                const filename = m.storageKey.split('/').pop();
                const isPng = m.storageKey.endsWith('.png');
                return (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: 10,
                      background: 'var(--pitch)',
                      borderRadius: 6,
                      border: '1px solid rgba(243,245,236,0.08)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 4,
                          background: 'rgba(245, 179, 53, 0.1)',
                          border: '1px solid rgba(245, 179, 53, 0.3)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 10,
                          fontWeight: 700,
                          color: 'var(--floodlight)',
                          flexShrink: 0,
                        }}
                      >
                        {isPng ? 'PNG' : 'JPG'}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div className="mono" style={{ fontSize: 11, color: 'var(--chalk)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {filename}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--chalk-muted)' }}>
                          Sanitized &amp; Protected
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteImage(m.id)}
                      disabled={deletingMediaId === m.id || uploading}
                      className="btn btn-ghost"
                      style={{
                        padding: '4px 8px',
                        fontSize: 11,
                        color: 'var(--card-red)',
                        borderColor: 'rgba(239, 68, 68, 0.3)',
                        flexShrink: 0,
                      }}
                    >
                      {deletingMediaId === m.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </>
  );
}

