import { Metadata } from 'next';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { prisma } from '@/lib/prisma';
import { buildMetadata } from '@/lib/seo/metadata';
import { breadcrumbJsonLd, ORG_JSON_LD } from '@/lib/seo/structured-data';

export const metadata: Metadata = buildMetadata({
  title: 'Prediction Archive — PredictPro',
  description: 'Browse completed football predictions with verified results. Transparent archive showing won and lost predictions with booking codes.',
  pathname: '/archive',
});

export const dynamic = 'force-dynamic';

export default async function PublicArchivePage() {
  const posts = await prisma.predictionPost.findMany({
    where: { status: 'archived', outcome: { in: ['won', 'lost'] } },
    orderBy: { updatedAt: 'desc' },
    include: { items: true },
  });

  const breadcrumbs = breadcrumbJsonLd([
    { name: 'Home', href: '/' },
    { name: 'Prediction Archive', href: '/archive' },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ORG_JSON_LD) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }}
      />

      <Header />
      <section className="section">
        <div className="container" style={{ maxWidth: 960 }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>ARCHIVE</div>
          <h1 className="display" style={{ fontSize: 36, marginBottom: 24 }}>Prediction Archive</h1>
          <p style={{ color: 'var(--chalk-muted)', marginBottom: 32, lineHeight: 1.6 }}>
            Completed predictions marked as won or lost. These results are published for transparency.
          </p>

          {posts.length === 0 ? (
            <p style={{ color: 'var(--chalk-muted)' }}>No archived predictions yet.</p>
          ) : (
            <div style={{ display: 'grid', gap: 16 }}>
              {posts.map((post) => (
                <article
                  key={post.id}
                  style={{
                    padding: 20,
                    background: 'var(--pitch)',
                    borderRadius: 4,
                    border: '1px solid rgba(243,245,236,0.1)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontWeight: 700, color: 'var(--chalk)', fontSize: 16 }}>{post.title}</span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          padding: '2px 10px',
                          borderRadius: 999,
                          background: post.outcome === 'won' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                          color: post.outcome === 'won' ? '#10b981' : '#ef4444',
                        }}
                      >
                        {post.outcome}
                      </span>
                    </div>
                    <time className="mono" style={{ fontSize: 12, color: 'var(--chalk-muted)' }} dateTime={post.scheduledAt.toISOString()}>
                      {new Date(post.scheduledAt).toLocaleDateString()}
                    </time>
                  </div>

                  {post.bookingCode && (
                    <p className="mono" style={{ fontSize: 13, color: 'var(--chalk-muted)', marginBottom: 10 }}>
                      Booking code: <span style={{ color: 'var(--floodlight)' }}>{post.bookingCode}</span>
                    </p>
                  )}

                  {post.items?.length ? (
                    <div style={{ display: 'grid', gap: 6 }}>
                      {post.items.map((item) => (
                        <div key={item.id} style={{ fontSize: 14, display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid rgba(243,245,236,0.06)' }}>
                          <span>{item.match}</span>
                          <span className="mono" style={{ color: 'var(--chalk-muted)' }}>{item.prediction}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
      <Footer />
    </>
  );
}