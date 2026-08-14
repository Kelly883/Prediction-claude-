'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiJson, apiFetch } from '@/lib/api-client';

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
    setUploading(true);
    setError(null);
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

  if (loading) {
    return (
      <>
        <div className="container section">Loading…</div>
      </>
    );
  }

  if (!post) {
    return (
      <>
        <div className="container section">Not found.</div>
      </>
    );
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

              {error && <div className="error-text">{error}</div>}

              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button onClick={save} className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
                {post.status !== 'published' && (
                  <button onClick={publish} className="btn btn-ghost">Publish</button>
                )}
              </div>
              <button onClick={archive} className="btn btn-ghost" style={{ color: 'var(--card-red)', borderColor: 'var(--card-red)' }}>
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
              <h2 style={{ fontSize: 16, marginBottom: 12 }}>Images</h2>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadImage} disabled={uploading} />
              {uploading && <p style={{ fontSize: 13, color: 'var(--chalk-muted)', marginTop: 8 }}>Uploading…</p>}

              <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
                {post.media.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--chalk-muted)' }}>No images uploaded yet.</p>
                ) : (
                  post.media.map((m) => (
                    <div key={m.id} className="mono" style={{ fontSize: 12, color: 'var(--chalk-muted)', padding: 8, background: 'var(--pitch)', borderRadius: 4 }}>
                      {m.storageKey.split('/').pop()}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
    </>
  );
}
