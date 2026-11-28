'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type ArchivedPost = {
  id: string;
  title: string;
  scheduledAt: string;
  outcome: 'won' | 'lost';
  updatedAt: string;
  items: Array<{ match: string; prediction: string }>;
};

type ResultSkeletonProps = { count?: number };

function ResultSkeleton({ count = 3 }: ResultSkeletonProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {[...Array(count)].map((_, i) => (
        <div key={i} style={{ padding: 20, background: '#0B1C17', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ height: 16, width: '50%', background: 'rgba(255,255,255,0.06)', borderRadius: 4, animation: 'pulse 1.5s ease-in-out infinite' }} />
          <div style={{ height: 14, width: '30%', background: 'rgba(255,255,255,0.06)', borderRadius: 4, animation: 'pulse 1.5s ease-in-out infinite' }} />
          <div style={{ height: 14, width: '20%', background: 'rgba(255,255,255,0.06)', borderRadius: 4, animation: 'pulse 1.5s ease-in-out infinite' }} />
        </div>
      ))}
    </div>
  );
}

export default function ResultsPreview() {
  const [posts, setPosts] = useState<ArchivedPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/public/predictions/archive?page=1&pageSize=6', {
          next: { revalidate: 300 },
        });
        if (!res.ok) throw new Error('Failed to load results');
        const data = await res.json();
        // Backward compatible: the public archive API now returns a paginated
        // object, but older deployments may still return a plain array.
        const posts = Array.isArray(data) ? data : (data.posts ?? []);
        if (!cancelled) setPosts(posts);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load results.');
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (posts === null) {
    return (
      <section style={{ padding: '64px 0', background: '#07110F' }}>
        <div className="container">
          <ResultSkeleton count={3} />
        </div>
      </section>
    );
  }

  return (
    <section style={{ padding: '64px 0', background: '#07110F' }}>
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 16, marginBottom: 32 }}>
          <div>
            <p style={{ fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.18em', fontSize: 12, color: '#18C964', fontWeight: 600, margin: '0 0 8px' }}>
              Results Transparency
            </p>
            <h2 style={{ fontSize: 'clamp(26px, 4vw, 36px)', lineHeight: 1.1, fontWeight: 800, color: '#FFFFFF', margin: 0 }}>
              Every prediction deserves a result.
            </h2>
          </div>
          <Link
            href="/archive"
            style={{
              textDecoration: 'none',
              color: '#FFFFFF',
              fontSize: 14,
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            View full archive <span style={{ fontSize: 16 }}>&rarr;</span>
          </Link>
        </div>

        <p style={{ maxWidth: 600, color: 'var(--chalk-muted)', lineHeight: 1.6, marginBottom: 28 }}>
          Follow completed predictions and review historical performance through our results archive.
        </p>

        {error ? (
          <div style={{ padding: 32, background: '#0B1C17', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, textAlign: 'center', color: 'var(--chalk-muted)' }}>
            <p style={{ margin: '0 0 16px' }}>{error}</p>
            <button onClick={() => window.location.reload()} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.3)', color: '#FFFFFF', padding: '8px 18px', borderRadius: 8, cursor: 'pointer', fontSize: 14 }}>
              Try again
            </button>
          </div>
        ) : posts.length === 0 ? (
          <div style={{ padding: 48, background: '#0B1C17', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, textAlign: 'center' }}>
            <p style={{ color: 'var(--chalk-muted)', fontSize: 16, margin: '0 0 16px' }}>No completed predictions yet.</p>
            <p style={{ color: 'var(--chalk-muted)', fontSize: 14, margin: 0 }}>Results will appear here as matchdays conclude.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {posts.slice(0, 6).map((post) => {
              const date = new Date(post.scheduledAt);
              const isValidDate = !isNaN(date.getTime());
              const won = post.outcome === 'won';
              return (
                <div
                  key={post.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 20',
                    background: '#0B1C17',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 10,
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 200 }}>
                    <span
                      style={{
                        fontSize: 15,
                        fontWeight: 600,
                        color: '#FFFFFF',
                        letterSpacing: '-0.01em',
                      }}
                    >
                      {post.title}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        color: 'var(--chalk-muted)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {isValidDate ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: '0.12em',
                      padding: '4px 12px',
                      borderRadius: 6,
                      background: won ? 'rgba(24, 201, 100, 0.10)' : 'rgba(193, 68, 59, 0.10)',
                      color: won ? '#18C964' : '#c1443b',
                      border: won ? '1px solid rgba(24, 201, 100, 0.25)' : '1px solid rgba(193, 68, 59, 0.25)',
                    }}
                  >
                    {post.outcome.toUpperCase()}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
