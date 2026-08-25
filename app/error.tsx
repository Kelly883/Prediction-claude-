'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error('Application error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--pitch)', padding: 24 }}>
          <div style={{ textAlign: 'center', maxWidth: 480 }}>
            <div className="eyebrow" style={{ marginBottom: 14 }}>ERROR</div>
            <h1 style={{ fontSize: 48, marginBottom: 16, color: 'var(--chalk)' }}>Something went wrong</h1>
            <p style={{ color: 'var(--chalk-muted)', marginBottom: 8 }}>
              An unexpected error occurred. Please try again.
            </p>
            <p style={{ color: 'var(--chalk-muted)', marginBottom: 32, fontSize: 14 }}>
              Error reference: {Math.random().toString(36).slice(2, 10).toUpperCase()}
            </p>
            <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => reset()} className="btn btn-primary">Try again</button>
              <Link href="/" className="btn btn-ghost" style={{ textDecoration: 'none' }}>Back to home</Link>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
