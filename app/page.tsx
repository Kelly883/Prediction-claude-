import { Metadata } from 'next';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import HeroSection from '@/components/HeroSection';
import MatchdayPreview from '@/components/MatchdayPreview';
import BenefitsSection from '@/components/BenefitsSection';
import LeagueCoverage from '@/components/LeagueCoverage';
import HowItWorks from '@/components/HowItWorks';
import ResultsPreview from '@/components/ResultsPreview';
import SubscriptionCTA from '@/components/SubscriptionCTA';
import { getPublishedTipCount } from '@/lib/stats';
import { getCmsSections } from '@/lib/cms';
import { buildMetadata } from '@/lib/seo/metadata';
import { ORG_JSON_LD, WEBSITE_JSON_LD, breadcrumbJsonLd } from '@/lib/seo/structured-data';

export const metadata: Metadata = {
  ...buildMetadata({
    title: 'PredictPro | Football Predictions, Matchday Insights & Results',
    description: 'Explore football predictions, matchday insights, booking codes and transparent prediction results with PredictPro.',
    pathname: '/',
  }),
};

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  // Defensive: the homepage must render even if a data source fails. Each
  // helper already catches internally, but we guard the whole load so an
  // unexpected throw (e.g. a null CMS payload) can never blank the page.
  let tipCount = 0;
  let announcement: { heading?: string; body?: string } | undefined;
  try {
    const [count, homepageSections] = await Promise.all([
      getPublishedTipCount(),
      getCmsSections('homepage'),
    ]);
    tipCount = count;
    announcement = homepageSections.announcement as { heading?: string; body?: string } | undefined;
  } catch (err) {
    console.error('[home] Failed to load homepage data; rendering with fallbacks.', err);
  }

  const breadcrumbs = breadcrumbJsonLd([{ name: 'Home', href: '/' }]);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ORG_JSON_LD) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(WEBSITE_JSON_LD) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }} />

      <Header />

      {announcement?.body && (
        <div style={{ background: 'var(--floodlight)', color: '#07110F' }}>
          <div className="container" style={{ padding: '10px 24px', fontSize: 14, fontWeight: 600 }}>
            {announcement.heading ? `${announcement.heading} — ` : ''}{announcement.body}
          </div>
        </div>
      )}

      <HeroSection />

      <MatchdayPreview />

      <section style={{ padding: '64px 0', background: '#0B1C17' }}>
        <div className="container">

          <p style={{ fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.18em', fontSize: 12, color: '#18C964', fontWeight: 600, margin: '0 0 12px' }}>
            Trusted by matchday subscribers
          </p>
          <p style={{ fontSize: 14, color: 'var(--chalk-muted)', lineHeight: 1.6, marginBottom: 32, maxWidth: 560 }}>
            Over {tipCount.toLocaleString()} published prediction posts available through subscriptions.
          </p>
          <BenefitsSection />
        </div>
      </section>

      <LeagueCoverage />

      <HowItWorks />

      <ResultsPreview />

      <SubscriptionCTA />

      <Footer />
    </>
  );
}
