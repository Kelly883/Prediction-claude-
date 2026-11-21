import { Metadata } from 'next';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import HowItWorks from '@/components/HowItWorks';
import { buildMetadata } from '@/lib/seo/metadata';
import { ORG_JSON_LD, breadcrumbJsonLd } from '@/lib/seo/structured-data';

export const metadata: Metadata = buildMetadata({
  title: 'How PredictPro Works — Football Predictions in 3 Steps',
  description: 'Choose a plan, access matchday predictions with booking codes, and follow transparent results. Everything you need for your next matchday.',
  pathname: '/how-it-works',
});

export default function HowItWorksPage() {
  const breadcrumbs = breadcrumbJsonLd([
    { name: 'Home', href: '/' },
    { name: 'How it works', href: '/how-it-works' },
  ]);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ORG_JSON_LD) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }} />
      <Header />
      <section style={{ padding: '80px 0', background: '#07110F' }}>
        <div className="container">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', textAlign: 'center', marginBottom: 56 }}>
            <p style={{ fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.18em', fontSize: 12, color: '#18C964', fontWeight: 600, margin: 0 }}>
              Getting Started
            </p>
            <h1 style={{ fontSize: 'clamp(32px, 6vw, 52px)', lineHeight: 1.1, fontWeight: 800, color: '#FFFFFF', margin: 0 }}>
              How PredictPro Works
            </h1>
            <p style={{ fontSize: 16, color: 'var(--chalk-muted)', lineHeight: 1.7, margin: '12px 0 0', maxWidth: 600 }}>
              From subscription to settled results, here is how you get matchday predictions with PredictPro.
            </p>
          </div>
          <HowItWorks />
        </div>
      </section>
      <Footer />
    </>
  );
}
