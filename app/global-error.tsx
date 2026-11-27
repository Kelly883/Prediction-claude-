'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

// Catches errors thrown in the root layout (which app/error.tsx cannot catch).
// Must render its own <html>/<body> because it replaces the root layout.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [retrying, setRetrying] = useState(false);
  const reference = error.digest || Math.random().toString(36).slice(2, 10).toUpperCase();

  useEffect(() => {
    console.error(`[global-error] reference=${reference}`, error);
  }, [error, reference]);

  function retry() {
    setRetrying(true);
    reset();
    setRetrying(false);
  }

  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#07110F' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#07110F', padding: 24 }}>
          <div style={{ textAlign: 'center', maxWidth: 480 }}>
            <div style={{ fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#18C964', fontWeight: 600, marginBottom: 14 }}>ERROR</div>
            <h1 style={{ fontSize: 48, margin: '0 0 16px', color: '#F3F5EC' }}>Something went wrong</h1>
            <p style={{ color: '#9CA3AF', marginBottom: 8 }}>
              We are having trouble loading this page. An unexpected error occurred. Please try again.
            </p>
            <p style={{ color: '#9CA3AF', marginBottom: 32, fontSize: 14 }}>
              Error reference: {reference}
            </p>
            <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={retry} disabled={retrying} style={{ background: '#18C964', color: '#07110F', border: 'none', borderRadius: 8, padding: '12px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                {retrying ? 'Retrying…' : 'Try again'}
              </button>
              <Link href="/" style={{ background: 'transparent', color: '#F3F5EC', border: '1px solid rgba(243,245,236,0.3)', borderRadius: 8, padding: '12px 20px', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
                Back to home
              </Link>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}