import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { buildMetadata } from '@/lib/seo/metadata';
import { breadcrumbJsonLd, ORG_JSON_LD } from '@/lib/seo/structured-data';

export const metadata = buildMetadata({
  title: 'Pricing & Plans — PredictPro',
  description: 'Choose a PredictPro subscription plan for verified football predictions with booking codes. Transparent pricing, no hidden fees.',
  pathname: '/pricing',
});

const breadcrumbs = breadcrumbJsonLd([
  { name: 'Home', href: '/' },
  { name: 'Pricing', href: '/pricing' },
]);

export default function PricingPage() {
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
        <div className="container">
          <div className="eyebrow" style={{ marginBottom: 18 }}>PRICING</div>
          <h1 className="display" style={{ fontSize: 'clamp(32px, 5vw, 52px)', maxWidth: 700 }}>
            Simple, transparent pricing
          </h1>
          <p style={{ maxWidth: 640, marginTop: 20, fontSize: 17, color: 'var(--chalk-muted)', lineHeight: 1.6 }}>
            Every plan gives you full access to verified football predictions with booking codes before every matchday.
          </p>

          <div style={{ marginTop: 48, display: 'grid', gap: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            <div style={{ padding: 32, background: 'var(--pitch)', borderRadius: 8, border: '1px solid rgba(243,245,236,0.08)' }}>
              <div className="eyebrow" style={{ marginBottom: 12 }}>VIP PASS</div>
              <h2 style={{ fontSize: 24, marginBottom: 8 }}>Matchday Access</h2>
              <p style={{ color: 'var(--chalk-muted)', marginBottom: 24, lineHeight: 1.6 }}>
                Full access to all predictions across covered leagues. One booking code per post.
              </p>
              <ul style={{ display: 'grid', gap: 12, marginBottom: 24 }}>
                <li style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--chalk)' }}>
                  <span style={{ color: 'var(--floodlight)' }}>✓</span> All league predictions
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--chalk)' }}>
                  <span style={{ color: 'var(--floodlight)' }}>✓</span> Booking codes included
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--chalk)' }}>
                  <span style={{ color: 'var(--floodlight)' }}>✓</span> Transparent results archive
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--chalk)' }}>
                  <span style={{ color: 'var(--floodlight)' }}>✓</span> Delivered before kickoff
                </li>
              </ul>
              <Link href="/register" className="btn btn-primary" style={{ width: '100%', textAlign: 'center' }}>
                Create account to view plans
              </Link>
            </div>

            <div style={{ padding: 32, background: 'var(--pitch)', borderRadius: 8, border: '1px solid rgba(243,245,236,0.08)' }}>
              <div className="eyebrow" style={{ marginBottom: 12, color: 'var(--floodlight)' }}>HOW IT WORKS</div>
              <h2 style={{ fontSize: 24, marginBottom: 8 }}>Subscribe & unlock</h2>
              <p style={{ color: 'var(--chalk-muted)', marginBottom: 24, lineHeight: 1.6 }}>
                Pricing is shown after registration. Plans are duration-based passes — pay once, access all predictions for the pass period.
              </p>
              <ul style={{ display: 'grid', gap: 12, marginBottom: 24 }}>
                <li style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--chalk-muted)' }}>
                  <span style={{ color: 'var(--floodlight)' }}>1</span> Create free account
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--chalk-muted)' }}>
                  <span style={{ color: 'var(--floodlight)' }}>2</span> Choose a pass duration
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--chalk-muted)' }}>
                  <span style={{ color: 'var(--floodlight)' }}>3</span> Pay securely (Paystack/Flutterwave)
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--chalk-muted)' }}>
                  <span style={{ color: 'var(--floodlight)' }}>4</span> Instant access to all predictions
                </li>
              </ul>
              <Link href="/register" className="btn btn-ghost" style={{ width: '100%', textAlign: 'center' }}>
                Get started free
              </Link>
            </div>
          </div>

          <div style={{ marginTop: 48, padding: 24, background: 'rgba(243,245,236,0.04)', borderRadius: 8, border: '1px solid rgba(243,245,236,0.08)' }}>
            <h3 style={{ marginBottom: 16 }}>No hidden fees • Cancel anytime • Secure payments</h3>
            <p style={{ color: 'var(--chalk-muted)', lineHeight: 1.6 }}>
              All payments processed via Paystack or Flutterwave. Auto-renewal can be disabled from your dashboard.
              <strong style={{ color: 'var(--chalk)' }}> Predictions are for informational purposes only.</strong> Please gamble responsibly.
            </p>
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}