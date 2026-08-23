'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { apiJson } from '@/lib/api-client';

type Me = { role: 'admin' | 'user' | 'superadmin' };
type MediaAsset = { id: string };
type PostDetail = {
  id: string;
  title: string;
  scheduledAt: string;
  locked: boolean;
  matchCount?: number;
  bookingCode?: string;
  bodyNotes?: string | null;
  items?: { id: string; match: string; prediction: string }[];
  media?: MediaAsset[];
};

export default function PredictionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [me, setMe] = useState<Me | null>(null);
  const [post, setPost] = useState<PostDetail | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiJson<Me>('/api/me').then(setMe).catch(() => {});
    apiJson<PostDetail>(`/api/predictions/${id}`)
      .then(setPost)
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!post || post.locked || !post.media) return;
    post.media.forEach((asset) => {
      apiJson<{ url: string }>(`/api/media/${asset.id}/signed-url`)
        .then((data) => setImageUrls((prev) => ({ ...prev, [asset.id]: data.url })))
        .catch(() => {});
    });
  }, [post]);

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
    <div style={{ maxWidth: 640 }}>
      <Link href="/dashboard" style={{ fontSize: 13, color: 'var(--chalk-muted)' }}>← Back to dashboard</Link>

          <h1 className="display" style={{ fontSize: 28, marginTop: 16, marginBottom: 4 }}>{post.title}</h1>
          <p className="mono" style={{ fontSize: 13, color: 'var(--chalk-muted)', marginBottom: 24 }}>
            {new Date(post.scheduledAt).toLocaleString()}
          </p>

          {post.locked ? (
            <div className="card" style={{ textAlign: 'center' }}>
              <p style={{ color: 'var(--floodlight)', marginBottom: 16 }}>
                🔒 {post.matchCount} matches — subscribe to unlock this tip
              </p>
              <Link href="/dashboard/plans" className="btn btn-primary">See plans</Link>
            </div>
          ) : (
            <div className="card">
              <p className="mono" style={{ fontSize: 14, marginBottom: 16 }}>
                Booking code: <span style={{ color: 'var(--floodlight)' }}>{post.bookingCode}</span>
              </p>

              {post.bodyNotes && <p style={{ color: 'var(--chalk-muted)', fontSize: 14, marginBottom: 16 }}>{post.bodyNotes}</p>}

              <div style={{ display: 'grid', gap: 8, marginBottom: post.media?.length ? 20 : 0 }}>
                {post.items?.map((item) => (
                  <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '8px 0', borderTop: '1px solid rgba(243,245,236,0.08)' }}>
                    <span>{item.match}</span>
                    <span className="mono" style={{ color: 'var(--floodlight)' }}>{item.prediction}</span>
                  </div>
                ))}
              </div>

              {post.media?.map((asset) =>
                imageUrls[asset.id] ? (
                  <img key={asset.id} src={imageUrls[asset.id]} alt="" style={{ width: '100%', borderRadius: 4, marginTop: 12 }} />
                ) : null,
              )}
            </div>
          )}
    </div>
  );
}
