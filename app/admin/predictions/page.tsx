'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiJson } from '@/lib/api-client';

type Post = { id: string; title: string; status: string; scheduledAt: string; bookingCode: string };

const emptyItem = () => ({ match: '', prediction: '' });

export default function AdminPredictionsPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [bookingCode, setBookingCode] = useState('');
  const [visibility, setVisibility] = useState<'plan_specific' | 'subscribers' | 'free_window'>('subscribers');
  const [items, setItems] = useState([emptyItem()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    apiJson<Post[]>('/api/predictions').then(setPosts).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function createPost(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiJson('/api/admin/predictions', {
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
      setTitle(''); setScheduledAt(''); setBookingCode(''); setItems([emptyItem()]); setShowForm(false);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function publish(id: string) {
    await apiJson(`/api/admin/predictions/${id}/publish`, { method: 'POST' });
    load();
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        <h1 className="display" style={{ fontSize: 28 }}>Predictions</h1>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href="/admin/predictions/csv" className="btn btn-ghost" style={{ padding: '8px 16px', fontSize: 13 }}>Import CSV</Link>
          <button onClick={() => setShowForm((s) => !s)} className="btn btn-primary" style={{ padding: '8px 16px', fontSize: 13 }}>
            {showForm ? 'Cancel' : 'New post'}
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={createPost} className="card" style={{ marginBottom: 24 }}>
          <div className="field">
            <label htmlFor="title">Title</label>
            <input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Saturday Big Wins" />
          </div>
          <div className="admin-grid-half" style={{ marginBottom: 16 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="scheduledAt">Scheduled</label>
              <input id="scheduledAt" type="datetime-local" required value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="bookingCode">Booking code</label>
              <input id="bookingCode" required value={bookingCode} onChange={(e) => setBookingCode(e.target.value)} placeholder="AB12CD" />
            </div>
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

          <label style={{ fontSize: 13, color: 'var(--chalk-muted)' }}>Matches</label>
          {items.map((item, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) auto', gap: 8, marginBottom: 8, marginTop: 8 }}>
              <input
                placeholder="Man Utd vs Arsenal"
                value={item.match}
                onChange={(e) => setItems(items.map((it, idx) => (idx === i ? { ...it, match: e.target.value } : it)))}
                style={{ background: 'var(--pitch)', border: '1px solid rgba(243,245,236,0.14)', borderRadius: 4, padding: '10px 12px', color: 'var(--chalk)', minWidth: 0 }}
              />
              <input
                placeholder="Over 2.5"
                value={item.prediction}
                onChange={(e) => setItems(items.map((it, idx) => (idx === i ? { ...it, prediction: e.target.value } : it)))}
                style={{ background: 'var(--pitch)', border: '1px solid rgba(243,245,236,0.14)', borderRadius: 4, padding: '10px 12px', color: 'var(--chalk)', minWidth: 0 }}
              />
              <button type="button" onClick={() => setItems(items.filter((_, idx) => idx !== i))} className="btn btn-ghost" style={{ padding: '0 12px' }}>×</button>
            </div>
          ))}
          <button type="button" onClick={() => setItems([...items, emptyItem()])} className="btn btn-ghost" style={{ fontSize: 13, marginBottom: 16 }}>
            + Add match
          </button>

          {error && <div className="error-text">{error}</div>}
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save as draft'}</button>
        </form>
      )}

      <div className="card">
        {loading ? (
          <p>Loading…</p>
        ) : (
          <div className="table-container">
            <table style={{ width: '100%', minWidth: 480, borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--chalk-muted)', fontSize: 12 }}>
                  <th style={{ padding: '8px 0' }}>Title</th>
                  <th>Scheduled</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {posts.map((p) => (
                  <tr key={p.id} style={{ borderTop: '1px solid rgba(243,245,236,0.08)' }}>
                    <td style={{ padding: '8px 0' }}>{p.title}</td>
                    <td>{new Date(p.scheduledAt).toLocaleString()}</td>
                    <td style={{ textTransform: 'capitalize', color: p.status === 'published' ? 'var(--floodlight)' : 'var(--chalk-muted)' }}>{p.status}</td>
                    <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Link href={`/admin/predictions/${p.id}`} className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }}>Edit</Link>
                      {p.status !== 'published' && (
                        <button onClick={() => publish(p.id)} className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }}>Publish</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
