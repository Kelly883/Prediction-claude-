import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Ticker from '@/components/Ticker';
import { getPublishedTipCount } from '@/lib/stats';
import { getCmsSections } from '@/lib/cms';

// Queries the DB directly (no static content to prerender at build time,
// and no DB connection guaranteed to exist during CI/build anyway).
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
          <div style={{ display: 'flex', gap: 14, marginTop: 32 }}>
            <Link href="/register" className="btn btn-primary">Get started</Link>
            <Link href="/login" className="btn btn-ghost">Sign in to account</Link>
          </div>
        </div>
      </section>

      <Ticker tipCount={tipCount} />

      <section className="section-tight" style={{ background: 'var(--turf)', borderTop: '1px solid rgba(243,245,236,0.14)', borderBottom: '1px solid rgba(243,245,236,0.14)' }}>
        <div className="container" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 32 }}>
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

      <Footer />
    </>
  );
}
