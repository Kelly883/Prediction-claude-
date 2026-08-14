'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { apiJson } from '@/lib/api-client';

function CallbackContent() {
  const params = useSearchParams();
  // Paystack sends ?reference=..., Flutterwave sends ?tx_ref=... — both are
  // the same value we generated in initializePayment() either way.
  const reference = params.get('reference') ?? params.get('tx_ref');
  const [status, setStatus] = useState<'checking' | 'success' | 'failed' | 'pending' | 'error'>('checking');

  useEffect(() => {
    if (!reference) {
      setStatus('error');
      return;
    }

    let cancelled = false;
    let attempts = 0;

    async function poll() {
      try {
        const data = await apiJson<{ status: string }>(`/api/payments/status?reference=${encodeURIComponent(reference!)}`);
        if (cancelled) return;
        if (data.status === 'success' || data.status === 'failed') {
          setStatus(data.status as 'success' | 'failed');
          return;
        }
        // Still pending — the webhook may not have landed yet. Poll a few
        // times before giving up, since webhook delivery isn't instant.
        attempts++;
        if (attempts < 8) setTimeout(poll, 2000);
        else setStatus('pending');
      } catch {
        if (!cancelled) setStatus('error');
      }
    }

    poll();
    return () => {
      cancelled = true;
    };
  }, [reference]);

  return (
    <div className="card" style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
      {status === 'checking' && <p>Confirming your payment…</p>}
      {status === 'success' && (
        <>
          <h2 className="display" style={{ fontSize: 24, marginBottom: 12 }}>Payment confirmed</h2>
          <p style={{ color: 'var(--chalk-muted)', marginBottom: 20 }}>Your plan is now active.</p>
          <Link href="/dashboard" className="btn btn-primary">Go to your dashboard</Link>
        </>
      )}
      {status === 'failed' && (
        <>
          <h2 className="display" style={{ fontSize: 24, marginBottom: 12, color: 'var(--card-red)' }}>Payment failed</h2>
          <p style={{ color: 'var(--chalk-muted)', marginBottom: 20 }}>Nothing was charged. You can try again.</p>
          <Link href="/dashboard/plans" className="btn btn-primary">Back to plans</Link>
        </>
      )}
      {status === 'pending' && (
        <>
          <p style={{ color: 'var(--chalk-muted)', marginBottom: 20 }}>
            Still confirming — this can take a minute. Check your dashboard shortly.
          </p>
          <Link href="/dashboard" className="btn btn-ghost">Go to your dashboard</Link>
        </>
      )}
      {status === 'error' && <p style={{ color: 'var(--card-red)' }}>Couldn't confirm this payment. Check your dashboard.</p>}
    </div>
  );
}

export default function PaymentsCallbackPage() {
  return (
    <>
      <Header />
      <section className="section">
        <div className="container">
          <Suspense fallback={<p>Loading…</p>}>
            <CallbackContent />
          </Suspense>
        </div>
      </section>
      <Footer />
    </>
  );
}
