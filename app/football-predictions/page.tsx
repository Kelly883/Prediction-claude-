import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { buildMetadata } from '@/lib/seo/metadata';
import { breadcrumbJsonLd, ORG_JSON_LD } from '@/lib/seo/structured-data';

export const metadata = buildMetadata({
  title: 'Football Predictions — PredictPro',
  description: 'Verified football predictions with real booking codes. Subscribe once and get every tip your plan covers before every matchday.',
  pathname: '/football-predictions',
});

export default function FootballPredictionsPage() {
  const breadcrumbs = breadcrumbJsonLd([
    { name: 'Home', href: '/' },
    { name: 'Football Predictions', href: '/football-predictions' },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ORG_JSON_LD) }}
      />
      <Header />
      <section className="section" style={{ paddingBottom: 56 }}>
        <div className="container">
          <div className="eyebrow" style={{ marginBottom: 18 }}>FOOTBALL PREDICTIONS</div>
          <h1 className="display" style={{ fontSize: 'clamp(36px, 6vw, 64px)', maxWidth: 780 }}>
            Verified football predictions, delivered before every matchday.
          </h1>
          <p style={{ maxWidth: 640, marginTop: 24, fontSize: 17, color: 'var(--chalk-muted)', lineHeight: 1.6 }}>
            PredictPro provides researched football predictions with real booking codes included. Subscribe to a plan and receive tips covering the leagues you care about.
          </p>

          <div style={{ display: 'grid', gap: 24, marginTop: 48, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            <div style={{ padding: 24, background: 'var(--pitch)', borderRadius: 4, border: '1px solid rgba(243,245,236,0.08)' }}>
              <div className="eyebrow" style={{ marginBottom: 10 }}>HOW IT WORKS</div>
              <p style={{ color: 'var(--chalk-muted)', fontSize: 15, lineHeight: 1.6 }}>
                Pick a plan, subscribe securely, and receive predictions before kickoff. Each post includes one booking code covering all its matches.
              </p>
            </div>
            <div style={{ padding: 24, background: 'var(--pitch)', borderRadius: 4, border: '1px solid rgba(243,245,236,0.08)' }}>
              <div className="eyebrow" style={{ marginBottom: 10 }}>SUPPORTED LEAGUES</div>
              <p style={{ color: 'var(--chalk-muted)', fontSize: 15, lineHeight: 1.6 }}>
                Premier League, Champions League, La Liga, Serie A, Bundesliga and more. Coverage depends on your plan.
              </p>
            </div>
            <div style={{ padding: 24, background: 'var(--pitch)', borderRadius: 4, border: '1px solid rgba(243,245,236,0.08)' }}>
              <div className="eyebrow" style={{ marginBottom: 10 }}>TRANSPARENT RESULTS</div>
              <p style={{ color: 'var(--chalk-muted)', fontSize: 15, lineHeight: 1.6 }}>
                Completed predictions are marked won or lost in our public archive. No hidden results, no cherry-picking.
              </p>
            </div>
          </div>

          <div style={{ marginTop: 48, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <Link href="/register" className="btn btn-primary">Get started</Link>
            <Link href="/pricing" className="btn btn-ghost">View plans</Link>
            <Link href="/faq" className="btn btn-ghost">Read FAQ</Link>
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}
