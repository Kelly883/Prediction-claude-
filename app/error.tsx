'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [retrying, setRetrying] = useState(false);

  // Use the stable server digest when available so the reference shown to the
  // user matches the server log entry. Fall back to a random ref only if the
  // runtime did not provide a digest (e.g. client-only errors).
  const reference = error.digest || Math.random().toString(36).slice(2, 10).toUpperCase();

  useEffect(() => {
    // Log the full error (message + stack) together with the reference so the
    // user-reported reference can be correlated with server/client logs.
    console.error(`[error-boundary] reference=${reference}`, error);
  }, [error, reference]);

  function retry() {
    setRetrying(true);
    // reset() re-renders the route segment and refetches server data.
    reset();
    setRetrying(false);
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--pitch)', padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 480 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>ERROR</div>
        <h1 style={{ fontSize: 48, marginBottom: 16, color: 'var(--chalk)' }}>Something went wrong</h1>
        <p style={{ color: 'var(--chalk-muted)', marginBottom: 8 }}>
          We are having trouble loading this page. An unexpected error occurred. Please try again.
        </p>
        <p style={{ color: 'var(--chalk-muted)', marginBottom: 32, fontSize: 14 }}>
          Error reference: {reference}
        </p>
        <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={retry} className="btn btn-primary" disabled={retrying}>{retrying ? 'Retrying…' : 'Try again'}</button>
          <Link href="/" className="btn btn-ghost" style={{ textDecoration: 'none' }}>Back to home</Link>
        </div>
      </div>
    </div>
  );
}