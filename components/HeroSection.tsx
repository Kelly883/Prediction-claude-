'use client';

import Image from 'next/image';
import Link from 'next/link';

export default function HeroSection() {
  return (
    <section className="relative w-full overflow-hidden" style={{ background: '#050805', paddingTop: '88px' }}>
      <div
        className="relative w-full"
        style={{
          height: '500px',
          minHeight: '500px',
        }}
      >
        <Image
          src="/images/hero-footballer-ball.jpg"
          alt=""
          fill
          priority
          sizes="(max-width: 768px) 100vw, 50vw"
          style={{
            objectFit: 'cover',
            objectPosition: 'center 30%',
            zIndex: 0,
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(90deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.15) 100%)',
            zIndex: 1,
          }}
        />
        <div className="absolute inset-0 flex flex-col justify-between p-4" style={{ zIndex: 2 }}>
          <div className="w-full max-w-screen-xl mx-auto px-4" style={{ paddingLeft: '20px', paddingTop: '32px' }}>
            <h1 className="font-bold leading-[1.05] text-white" style={{ fontSize: '40px', lineHeight: '1.05', maxWidth: '340px' }}>
              Make every<br />
              <span style={{ color: '#22C55E' }}>matchday</span><br />
              count.
            </h1>
            <p className="mt-4" style={{ fontSize: '15px', lineHeight: '1.5', color: '#D1D5DB', maxWidth: '280px' }}>
              Get accurate football predictions, booking codes and transparent results — all in one place.
            </p>
            <div className="mt-6 flex flex-col gap-3" style={{ maxWidth: '280px' }}>
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 px-5 py-3 text-center"
                style={{
                  background: '#22C55E',
                  color: '#000',
                  fontWeight: 700,
                  fontSize: '15px',
                  borderRadius: '999px',
                  width: 'fit-content',
                  textDecoration: 'none',
                }}
              >
                Explore Plans
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </Link>
              <Link
                href="/archive"
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-center"
                style={{
                  background: 'transparent',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: '14px',
                  borderRadius: '999px',
                  width: 'fit-content',
                  textDecoration: 'none',
                  border: '1.5px solid #22C55E',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="16" />
                </svg>
                View Results Archive
              </Link>
            </div>
          </div>

          <div className="w-full max-w-screen-xl mx-auto px-4 pb-6" style={{ paddingLeft: '20px' }} />
        </div>
      </div>
    </section>
  );
}