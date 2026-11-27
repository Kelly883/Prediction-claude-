import { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { prisma } from '@/lib/prisma';
import { buildMetadata } from '@/lib/seo/metadata';
import { breadcrumbJsonLd } from '@/lib/seo/structured-data';
import { addUtcDays, dailyPostQuery, selectPublicItemsForDay, utcDayBounds } from '@/lib/predictions/daily';

export const metadata: Metadata = buildMetadata({
  title: "Tomorrow's Football Predictions — PredictPro",
  description: 'Preview tomorrow football predictions. Subscribe to unlock full tips with booking codes.',
  pathname: '/predictions/tomorrow',
});

export const dynamic = 'force-dynamic';

export default async function TomorrowPredictionsPage() {
  const now = new Date();
  const bounds = utcDayBounds(addUtcDays(now, 1));

  const posts = await prisma.predictionPost.findMany(dailyPostQuery(bounds));

  const { items: publicItems, privatePostCount } = selectPublicItemsForDay(posts, bounds, now);

  const breadcrumbs = breadcrumbJsonLd([
    { name: 'Home', href: '/' },
    { name: "Tomorrow's Predictions", href: '/predictions/tomorrow' },
  ]);

  const dateLabel = bounds.start.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }}
      />
      <Header />
      <section className="section" style={{ paddingBottom: 56 }}>
        <div className="container">
          <div className="eyebrow" style={{ marginBottom: 18 }}>PUBLIC PREVIEW</div>
          <h1 className="display" style={{ fontSize: 'clamp(32px, 5vw, 52px)', maxWidth: 700 }}>
            {dateLabel}&apos;s football predictions
          </h1>
          <p style={{ maxWidth: 600, marginTop: 20, fontSize: 16, color: 'var(--chalk-muted)', lineHeight: 1.6 }}>
            A preview of tomorrow&apos;s matches. Subscribe to unlock the full predictions with booking codes.
          </p>

          {publicItems.length > 0 ? (
            <div style={{ marginTop: 32, display: 'grid', gap: 12, maxWidth: 640 }}>
              {publicItems.map(({ item }) => (
                <div
                  key={item.id}
                  style={{
                    padding: 16,
                    background: 'var(--pitch)',
                    borderRadius: 4,
                    border: '1px solid rgba(243,245,236,0.08)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--chalk)' }}>{item.match}</div>
                    <div className="mono" style={{ fontSize: 12, color: 'var(--chalk-muted)' }}>
                      {item.matchDateTime ? new Date(item.matchDateTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) : 'TBA'}
                    </div>
                  </div>
                  <div style={{ padding: '4px 12px', borderRadius: 999, background: 'rgba(16,185,129,0.12)', color: '#10b981', fontSize: 13, fontWeight: 600 }}>
                    {item.prediction}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ marginTop: 32, padding: 24, background: 'rgba(243,245,236,0.04)', borderRadius: 4, border: '1px solid rgba(243,245,236,0.08)', textAlign: 'center' }}>
              <p style={{ fontSize: 16, color: 'var(--chalk-muted)', lineHeight: 1.6 }}>
                No published predictions are available for tomorrow yet. Please check again later.
              </p>
            </div>
          )}

          {privatePostCount > 0 && (
            <div style={{ marginTop: 24, padding: 16, background: 'rgba(245,179,53,0.08)', borderRadius: 4, border: '1px solid rgba(245,179,53,0.2)' }}>
              <p style={{ fontSize: 14, color: 'var(--floodlight)', lineHeight: 1.6, marginBottom: 12 }}>
                <strong>{privatePostCount}</strong> additional prediction post{privatePostCount > 1 ? 's are' : ' is'} available for subscribers.
              </p>
              <Link href="/pricing" className="btn btn-primary" style={{ fontSize: 13 }}>
                View subscription plans
              </Link>
            </div>
          )}

          <div style={{ marginTop: 32, padding: 20, background: 'rgba(243,245,236,0.04)', borderRadius: 4, border: '1px solid rgba(243,245,236,0.08)' }}>
            <p style={{ fontSize: 14, color: 'var(--chalk-muted)', lineHeight: 1.6 }}>
              <strong style={{ color: 'var(--chalk)' }}>Note:</strong> Predictions are for informational purposes only. Betting involves risk. Please gamble responsibly.
            </p>
          </div>

          <div style={{ marginTop: 32, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <Link href="/pricing" className="btn btn-primary">Subscribe to unlock</Link>
            <Link href="/predictions/today" className="btn btn-ghost">Today&apos;s predictions</Link>
            <Link href="/archive" className="btn btn-ghost">Prediction archive</Link>
            <Link href="/faq" className="btn btn-ghost">FAQ</Link>
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}