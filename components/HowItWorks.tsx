'use client';

import Link from 'next/link';

/** How PredictPro Works – three simple steps for the user journey */
export default function HowItWorks() {
  return (
    <section className="section" style={{ background: 'var(--bg-primary)' }}>
      <div className="container">
        <h2 className="display mb-6" style={{ color: 'var(--accent-primary)' }}>
          How PredictPro Works
        </h2>
        <p style={{ color: 'var(--chalk-muted)', marginBottom: 32, maxWidth: 560, lineHeight: 1.7, margin: '12px 0 0' }}>
          Three simple steps to get started with football predictions.
        </p>
        <div className="grid gap-6 md:grid-cols-3" style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: 'rgba(24, 201, 100, 0.10)',
                border: '1px solid rgba(24, 201, 100, 0.20)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 20px',
                fontSize: 24,
                color: '#18C964',
              }}
            >
              01
            </div>
            <h3 style={{ textAlign: 'center', color: '#FFFFFF', margin: '12px 0 4px', fontSize: 18, fontWeight: 700 }}>
              Choose your plan
            </h3>
            <p style={{ textAlign: 'center', color: 'var(--chalk-muted)', fontSize: 14, lineHeight: 1.5 }}>
              Select a subscription that matches your needs and budget.
            </p>
            <Link href="/pricing" style={{ textAlign: 'center', color: 'var(--accent-primary)', fontSize: 14, textDecoration: 'none', fontWeight: 500 }}>
              Get started →
            </Link>
          </div>

          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: 'rgba(24, 201, 100, 0.10)',
              border: '1px solid rgba(24, 201, 100, 0.20)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px',
              fontSize: 24,
              color: '#18C964',
            }}
          >
            02
          </div>
          <div>
            <h3 style={{ textAlign: 'center', color: '#FFFFFF', margin: '12px 0 4px', fontSize: 18, fontWeight: 700 }}>
              Access your predictions
            </h3>
            <p style={{ textAlign: 'center', color: 'var(--chalk-muted)', fontSize: 14, lineHeight: 1.5 }}>
              View available match predictions, analysis and booking codes according to your subscription.
            </p>
            <Link href="/predictions/today" style={{ textAlign: 'center', color: 'var(--accent-primary)', fontSize: 14, textDecoration: 'none', fontWeight: 500 }}>
              View predictions →
            </Link>
          </div>

          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: 'rgba(24, 201, 100, 0.10)',
              border: '1px solid rgba(24, 201, 100, 0.20)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px',
              fontSize: 24,
              color: '#18C964',
            }}
          >
            03
          </div>
          <div>
            <h3 style={{ textAlign: 'center', color: '#FFFFFF', margin: '12px 0 4px', fontSize: 18, fontWeight: 700 }}>
              Follow the results
            </h3>
            <p style={{ textAlign: 'center', color: 'var(--chalk-muted)', fontSize: 14, lineHeight: 1.5 }}>
              Track completed predictions through the results archive.
            </p>
            <Link href="/archive" style={{ textAlign: 'center', color: 'var(--accent-primary)', fontSize: 14, textDecoration: 'none', fontWeight: 500 }}>
              View archive →
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
