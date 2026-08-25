import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { buildMetadata } from '@/lib/seo/metadata';
import { breadcrumbJsonLd } from '@/lib/seo/structured-data';

export const metadata = buildMetadata({
  title: 'La Liga Predictions — PredictPro',
  description: 'Get La Liga football predictions with booking codes. Subscribe to PredictPro for verified tips before every matchday.',
  pathname: '/leagues/la-liga',
});

export default function LaLigaPage() {
  const breadcrumbs = breadcrumbJsonLd([
    { name: 'Home', href: '/' },
    { name: 'Football Predictions', href: '/football-predictions' },
    { name: 'La Liga', href: '/leagues/la-liga' },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }}
      />
      <Header />
      <section className="section" style={{ paddingBottom: 56 }}>
        <div className="container">
          <div className="eyebrow" style={{ marginBottom: 18 }}>LEAGUE</div>
          <h1 className="display" style={{ fontSize: 'clamp(32px, 5vw, 52px)', maxWidth: 700 }}>
            La Liga predictions
          </h1>
          <p style={{ maxWidth: 640, marginTop: 20, fontSize: 17, color: 'var(--chalk-muted)', lineHeight: 1.6 }}>
            Verified predictions for Spain's top division. Subscribe to receive booking codes and analysis before every round of fixtures.
          </p>

          <div style={{ marginTop: 32, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <Link href="/register" className="btn btn-primary">Subscribe now</Link>
            <Link href="/football-predictions" className="btn btn-ghost">All predictions</Link>
            <Link href="/faq" className="btn btn-ghost">FAQ</Link>
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}
