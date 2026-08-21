'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { apiFetch } from '@/lib/api-client';

type PaymentStatus = 'checking' | 'success' | 'failed' | 'pending' | 'error' | 'unauthenticated' | 'verifying';

function CallbackContent() {
  const params = useSearchParams();
  const router = useRouter();
  const reference = params.get('reference') ?? params.get('tx_ref');
  const provider = params.get('provider') as 'paystack' | 'flutterwave' | null;
  const [status, setStatus] = useState<PaymentStatus>('checking');
  const [message, setMessage] = useState<string>('Confirming your payment…');
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    if (!reference) {
      setStatus('error');
      setMessage('Missing payment reference. Please check your dashboard or try again.');
      return;
    }

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 12; // ~24 seconds total

    async function poll() {
      try {
        const res = await apiFetch(`/api/payments/status?reference=${encodeURIComponent(reference!)}`);
        if (cancelled) return;

        if (!res.ok) {
          if (res.status === 401) {
            setStatus('unauthenticated');
            setMessage('Your session expired. Please log in again to check your payment status.');
            return;
          }
          if (res.status === 404) {
            setStatus('error');
            setMessage('Payment record not found. If you completed payment, it may still be processing.');
            return;
          }
          throw new Error(`Status check failed (HTTP ${res.status})`);
        }

        const data = await res.json();
        if (data.status === 'success' || data.status === 'failed') {
          setStatus(data.status);
          setMessage(data.status === 'success'
            ? 'Payment confirmed. Your plan is now active.'
            : 'Payment was not successful. Nothing was charged.');
          return;
        }

        attempts++;
        if (attempts < maxAttempts) {
          setMessage(`Still confirming… (attempt ${attempts}/${maxAttempts})`);
          setTimeout(poll, 2000);
        } else {
          setStatus('pending');
          setMessage('Still confirming — this can take a minute. Check your dashboard shortly or try refreshing.');
        }
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setMessage((err as Error).message || 'Could not confirm this payment. Check your dashboard.');
        }
      }
    }

    poll();
    return () => {
      cancelled = true;
    };
  }, [reference]);

  useEffect(() => {
    if (status === 'success') {
      const timer = setTimeout(() => router.replace('/dashboard/plans'), 3000);
      return () => clearTimeout(timer);
    }
    if (status === 'failed') {
      const timer = setTimeout(() => router.replace('/dashboard/plans'), 4000);
      return () => clearTimeout(timer);
    }
  }, [status, router]);

  const handleManualVerify = async () => {
    if (!reference || !provider || isVerifying) return;
    setIsVerifying(true);
    setStatus('verifying');
    setMessage('Manually verifying your payment with the provider…');

    try {
      const res = await apiFetch('/api/payments/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference, provider }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Verification failed (HTTP ${res.status})`);
      }

      const data = await res.json();
      if (data.status === 'success') {
        setStatus('success');
        setMessage('Payment verified manually. Your plan is now active.');
      } else {
        throw new Error('Unexpected verification response');
      }
    } catch (err) {
      setStatus('error');
      setMessage((err as Error).message || 'Manual verification failed. Please contact support or try again later.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleRetry = () => {
    setStatus('checking');
    setMessage('Re-checking payment status…');
    window.location.reload();
  };

  const canManualVerify = Boolean(reference && provider && !isVerifying);

  return (
    <div className="card" style={{ maxWidth: 520, margin: '0 auto', textAlign: 'center' }}>
      {status === 'checking' && (
        <div>
          <div className="admin-loading" style={{ marginBottom: 16 }}>{message}</div>
          <p style={{ color: 'var(--chalk-muted)', fontSize: 13 }}>Please do not close this page.</p>
        </div>
      )}

      {status === 'verifying' && (
        <div>
          <div className="admin-loading" style={{ marginBottom: 16 }}>{message}</div>
          <p style={{ color: 'var(--chalk-muted)', fontSize: 13 }}>Please wait while we confirm with your payment provider.</p>
        </div>
      )}

      {status === 'success' && (
        <>
          <h2 className="display" style={{ fontSize: 24, marginBottom: 12 }}>Payment confirmed</h2>
          <p style={{ color: 'var(--chalk-muted)', marginBottom: 8 }}>{message}</p>
          <p style={{ color: 'var(--chalk-muted)', marginBottom: 20, fontSize: 13 }}>Redirecting you to your plans…</p>
          <Link href="/dashboard/plans" className="btn btn-primary">Go to your plans now</Link>
        </>
      )}

      {status === 'failed' && (
        <>
          <h2 className="display" style={{ fontSize: 24, marginBottom: 12, color: 'var(--card-red)' }}>Payment failed</h2>
          <p style={{ color: 'var(--chalk-muted)', marginBottom: 8 }}>{message}</p>
          <p style={{ color: 'var(--chalk-muted)', marginBottom: 20, fontSize: 13 }}>Redirecting you back to plans…</p>
          <Link href="/dashboard/plans" className="btn btn-primary">Back to plans</Link>
        </>
      )}

      {status === 'pending' && (
        <>
          <h2 className="display" style={{ fontSize: 22, marginBottom: 12 }}>Still confirming</h2>
          <p style={{ color: 'var(--chalk-muted)', marginBottom: 20 }}>{message}</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            {canManualVerify && (
              <button onClick={handleManualVerify} disabled={isVerifying} className="btn btn-primary" style={{ flex: '1 1 auto' }}>
                {isVerifying ? 'Verifying…' : 'Verify manually'}
              </button>
            )}
            <button onClick={handleRetry} className="btn btn-ghost" style={{ flex: '1 1 auto' }}>
              Check again
            </button>
            <Link href="/dashboard/plans" className="btn btn-ghost" style={{ flex: '1 1 auto' }}>
              Back to plans
            </Link>
          </div>
        </>
      )}

      {status === 'error' && (
        <>
          <h2 className="display" style={{ fontSize: 22, marginBottom: 12, color: 'var(--card-red)' }}>Couldn’t confirm payment</h2>
          <p style={{ color: 'var(--chalk-muted)', marginBottom: 20 }}>{message}</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            {canManualVerify && (
              <button onClick={handleManualVerify} disabled={isVerifying} className="btn btn-primary" style={{ flex: '1 1 auto' }}>
                {isVerifying ? 'Verifying…' : 'Verify manually'}
              </button>
            )}
            <button onClick={handleRetry} className="btn btn-ghost" style={{ flex: '1 1 auto' }}>
              Try again
            </button>
            <Link href="/dashboard/plans" className="btn btn-ghost" style={{ flex: '1 1 auto' }}>
              Back to plans
            </Link>
          </div>
        </>
      )}

      {status === 'unauthenticated' && (
        <>
          <h2 className="display" style={{ fontSize: 22, marginBottom: 12, color: 'var(--card-red)' }}>Session expired</h2>
          <p style={{ color: 'var(--chalk-muted)', marginBottom: 20 }}>{message}</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/login" className="btn btn-primary" style={{ flex: '1 1 auto' }}>
              Log in again
            </Link>
            <Link href="/dashboard/plans" className="btn btn-ghost" style={{ flex: '1 1 auto' }}>
              Back to plans
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

export default function PaymentsCallbackPage() {
  return (
    <>
      <Header />
      <section className="section">
        <div className="container">
          <Suspense fallback={<div className="card" style={{ maxWidth: 520, margin: '0 auto', textAlign: 'center' }}>Loading…</div>}>
            <CallbackContent />
          </Suspense>
        </div>
      </section>
      <Footer />
    </>
  );
}
