import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { buildMetadata } from '@/lib/seo/metadata';
import { breadcrumbJsonLd } from '@/lib/seo/structured-data';

export const metadata = buildMetadata({
  title: "Today's Football Predictions — PredictPro",
  description: 'Preview today football predictions. Subscribe to unlock full tips with booking codes.',
  pathname: '/predictions/today',
});

export default function TodayPredictionsPage() {
  const breadcrumbs = breadcrumbJsonLd([
    { name: 'Home', href: '/' },
    { name: "Today's Predictions", href: '/predictions/today' },
  ]);

  const sampleMatches = [
    { match: 'Arsenal vs Chelsea', prediction: 'Home win', time: '16:00' },
    { match: 'Liverpool vs Man City', prediction: 'Draw', time: '18:30' },
    { match: 'Barcelona vs Real Madrid', prediction: 'Away win', time: '20:00' },
  ];

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
            Today's football predictions
          </h1>
          <p style={{ maxWidth: 600, marginTop: 20, fontSize: 16, color: 'var(--chalk-muted)', lineHeight: 1.6 }}>
            A preview of today's matches. Subscribe to unlock the full predictions with booking codes.
          </p>

          <div style={{ marginTop: 32, display: 'grid', gap: 12, maxWidth: 640 }}>
            {sampleMatches.map((item, idx) => (
              <div key={idx} style={{ padding: 16, background: 'var(--pitch)', borderRadius: 4, border: '1px solid rgba(243,245,236,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--chalk)' }}>{item.match}</div>
                  <div className="mono" style={{ fontSize: 12, color: 'var(--chalk-muted)' }}>{item.time}</div>
                </div>
                <div style={{ padding: '4px 12px', borderRadius: 999, background: 'rgba(16,185,129,0.12)', color: '#10b981', fontSize: 13, fontWeight: 600 }}>
                  {item.prediction}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 32, padding: 20, background: 'rgba(243,245,236,0.04)', borderRadius: 4, border: '1px solid rgba(243,245,236,0.08)' }}>
            <p style={{ fontSize: 14, color: 'var(--chalk-muted)', lineHeight: 1.6 }}>
              <strong style={{ color: 'var(--chalk)' }}>Note:</strong> Predictions are for informational purposes only. Betting involves risk. Please gamble responsibly.
            </p>
          </div>

          <div style={{ marginTop: 32, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <Link href="/register" className="btn btn-primary">Subscribe to unlock</Link>
            <Link href="/predictions/tomorrow" className="btn btn-ghost">Tomorrow's predictions</Link>
            <Link href="/faq" className="btn btn-ghost">FAQ</Link>
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}
