import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Ticker from '@/components/Ticker';
import { getPublishedTipCount } from '@/lib/stats';
import { getCmsSections } from '@/lib/cms';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const tipCount = await getPublishedTipCount();
  const homepageSections = await getCmsSections('homepage');
  const announcement = homepageSections.announcement as { heading?: string; body?: string } | undefined;

  return (
    <>
      <Header />

      {announcement?.body && (
        <div style={{ background: 'var(--floodlight)', color: 'var(--pitch)' }}>
          <div className="container" style={{ padding: '10px 24px', fontSize: 14, fontWeight: 600 }}>
            {announcement.heading ? `${announcement.heading} — ` : ''}{announcement.body}
          </div>
        </div>
      )}

      <section className="section" style={{ paddingBottom: 56 }}>
        <div className="container">
          <div className="eyebrow" style={{ marginBottom: 18 }}>MATCHDAY, EVERY DAY</div>
          <h1 className="display" style={{ fontSize: 'clamp(40px, 7vw, 76px)', maxWidth: 780 }}>
            Kick off on every winning bet.
          </h1>
          <p style={{ maxWidth: 520, marginTop: 24, fontSize: 17, color: 'var(--chalk-muted)', lineHeight: 1.6 }}>
            Verified football predictions with the booking code included, delivered before every matchday.
            Subscribe once, get every tip your plan covers.
          </p>
          <div style={{ display: 'flex', gap: 14, marginTop: 32, flexWrap: 'wrap' }}>
            <Link href="/register" className="btn btn-primary">Get started</Link>
            <Link href="/login" className="btn btn-ghost">Sign in to account</Link>
            <Link href="/archive" className="btn btn-ghost">Prediction Archive</Link>
            <Link href="/pricing" className="btn btn-ghost">Pricing</Link>
          </div>
        </div>
      </section>

      <Ticker tipCount={tipCount} />

      <section className="section-tight" style={{ background: 'var(--turf)', borderTop: '1px solid rgba(243,245,236,0.14)', borderBottom: '1px solid rgba(243,245,236,0.14)' }}>
        <div className="container" style={{ display: 'grid', gap: 32, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>SUBSCRIBE</div>
            <p style={{ color: 'var(--chalk-muted)', fontSize: 15, lineHeight: 1.6 }}>
              Pick a plan in NGN or USD — we detect and convert automatically outside Nigeria.
            </p>
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>NEW TIPS DROP</div>
            <p style={{ color: 'var(--chalk-muted)', fontSize: 15, lineHeight: 1.6 }}>
              New tips post to your feed before every matchday, covering the leagues your plan includes.
            </p>
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>USE THE CODE</div>
            <p style={{ color: 'var(--chalk-muted)', fontSize: 15, lineHeight: 1.6 }}>
              Every post carries one booking code covering all its matches — no digging through separate slips.
            </p>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingBottom: 56 }}>
        <div className="container">
          <div className="eyebrow" style={{ marginBottom: 18 }}>HOW IT WORKS</div>
          <h2 className="display" style={{ fontSize: 'clamp(28px, 4vw, 44px)', maxWidth: 640, marginBottom: 24 }}>
            Three steps to verified predictions
          </h2>
          <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            <div style={{ padding: 24, background: 'var(--pitch)', borderRadius: 4, border: '1px solid rgba(243,245,236,0.08)' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--floodlight)', marginBottom: 8 }}>1. CHOOSE A PLAN</div>
              <p style={{ color: 'var(--chalk-muted)', fontSize: 15, lineHeight: 1.6 }}>
                Select a subscription plan that matches the leagues and coverage you want. Prices are shown in NGN or USD depending on your location.
              </p>
            </div>
            <div style={{ padding: 24, background: 'var(--pitch)', borderRadius: 4, border: '1px solid rgba(243,245,236,0.08)' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--floodlight)', marginBottom: 8 }}>2. SUBSCRIBE SECURELY</div>
              <p style={{ color: 'var(--chalk-muted)', fontSize: 15, lineHeight: 1.6 }}>
                Pay via Paystack or Flutterwave. Your payment is verified and your subscription is activated automatically.
              </p>
            </div>
            <div style={{ padding: 24, background: 'var(--pitch)', borderRadius: 4, border: '1px solid rgba(243,245,236,0.08)' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--floodlight)', marginBottom: 8 }}>3. GET THE TIPS</div>
              <p style={{ color: 'var(--chalk-muted)', fontSize: 15, lineHeight: 1.6 }}>
                Receive predictions with booking codes before every matchday. Access your feed anytime from your dashboard.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingBottom: 56 }}>
        <div className="container">
          <div className="eyebrow" style={{ marginBottom: 18 }}>TRUST & TRANSPARENCY</div>
          <h2 className="display" style={{ fontSize: 'clamp(28px, 4vw, 44px)', maxWidth: 640, marginBottom: 24 }}>
            Results you can verify
          </h2>
          <p style={{ maxWidth: 640, color: 'var(--chalk-muted)', lineHeight: 1.6, marginBottom: 24 }}>
            Every completed prediction is marked won or lost in our public archive. We publish results transparently so you can track performance over time.
          </p>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <Link href="/archive" className="btn btn-primary">View prediction archive</Link>
            <Link href="/faq" className="btn btn-ghost">Read FAQ</Link>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingBottom: 56, background: 'var(--turf)', borderTop: '1px solid rgba(243,245,236,0.14)', borderBottom: '1px solid rgba(243,245,236,0.14)' }}>
        <div className="container">
          <div className="eyebrow" style={{ marginBottom: 18 }}>RESPONSIBLE USE</div>
          <h2 className="display" style={{ fontSize: 'clamp(28px, 4vw, 44px)', maxWidth: 640, marginBottom: 24 }}>
            Predictions are for informational purposes only
          </h2>
          <p style={{ maxWidth: 640, color: 'var(--chalk-muted)', lineHeight: 1.6, marginBottom: 16 }}>
            Betting involves risk. PredictPro provides researched football predictions with booking codes, but we do not guarantee outcomes. Please gamble responsibly and only stake what you can afford to lose.
          </p>
          <p style={{ maxWidth: 640, color: 'var(--chalk-muted)', lineHeight: 1.6 }}>
            If you or someone you know has a gambling problem, seek help from a professional organization in your country.
          </p>
        </div>
      </section>

      <section className="section" style={{ paddingBottom: 56 }}>
        <div className="container">
          <div className="eyebrow" style={{ marginBottom: 18 }}>SUPPORTED LEAGUES</div>
          <h2 className="display" style={{ fontSize: 'clamp(28px, 4vw, 44px)', maxWidth: 640, marginBottom: 24 }}>
            Coverage across major competitions
          </h2>
          <p style={{ maxWidth: 640, color: 'var(--chalk-muted)', lineHeight: 1.6, marginBottom: 24 }}>
            PredictPro covers the leagues that matter most. Depending on your plan, you will receive predictions for:
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {['Premier League', 'Champions League', 'La Liga', 'Serie A', 'Bundesliga'].map((league) => (
              <span key={league} style={{ padding: '8px 16px', background: 'var(--pitch)', borderRadius: 999, border: '1px solid rgba(243,245,236,0.08)', fontSize: 14, color: 'var(--chalk)' }}>
                {league}
              </span>
            ))}
          </div>
          <div style={{ marginTop: 32 }}>
            <Link href="/football-predictions" className="btn btn-primary">Explore all predictions</Link>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
