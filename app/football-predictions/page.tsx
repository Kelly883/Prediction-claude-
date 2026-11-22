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

const ctaStyles = `
.fpi-cta-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  margin-top: 48px;
}
@media (min-width: 768px) {
  .fpi-cta-grid { grid-template-columns: repeat(3, 1fr); }
}
.fpi-cta-btn {
  box-sizing: border-box;
  width: 100%;
  height: 56px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 18px;
  border-radius: 999px;
  font-size: 16px;
  font-weight: 700;
  white-space: nowrap;
  text-align: center;
  transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease, border-color 160ms ease;
}
.fpi-cta-btn > span {
  position: relative;
  z-index: 1;
}
.fpi-cta-btn:focus-visible {
  outline: 2px solid rgba(74, 222, 128, 0.9);
  outline-offset: 3px;
}
.fpi-cta-primary {
  position: relative;
  overflow: hidden;
  background: linear-gradient(135deg, #16A34A 0%, #22C55E 55%, #4ADE80 100%);
  color: #04120A;
  border: 1px solid transparent;
  box-shadow: 0 8px 24px rgba(34, 197, 94, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.35);
}
.fpi-cta-primary::after {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 50%;
  border-radius: 999px 999px 0 0;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.25), transparent 50%);
  pointer-events: none;
}
.fpi-cta-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 28px rgba(34, 197, 94, 0.45);
}
.fpi-cta-primary:active {
  transform: translateY(0);
}
.fpi-cta-secondary {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.10), rgba(255, 255, 255, 0.04));
  color: #FFFFFF;
  border: 1px solid rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
}
.fpi-cta-secondary:hover {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.06));
  border-color: rgba(34, 197, 94, 0.5);
}
@media (prefers-reduced-motion: reduce) {
  .fpi-cta-btn { transition: none; }
  .fpi-cta-primary:hover { transform: none; }
}
`;

function FootballPredictionsCta() {
  return (
    <>
      <style>{ctaStyles}</style>
      <div className="fpi-cta-grid">
        <Link href="/register" className="btn fpi-cta-btn fpi-cta-primary"><span>Get started</span></Link>
        <Link href="/pricing" className="btn fpi-cta-btn fpi-cta-secondary"><span>View plans</span></Link>
        <Link href="/faq" className="btn fpi-cta-btn fpi-cta-secondary"><span>Read FAQ</span></Link>
      </div>
    </>
  );
}

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

          <FootballPredictionsCta />
        </div>
      </section>
      <Footer />
    </>
  );
}
