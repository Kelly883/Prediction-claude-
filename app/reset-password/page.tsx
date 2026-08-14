'use client';

import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import PasswordField from '@/components/PasswordField';
import PasswordStrengthMeter from '@/components/PasswordStrengthMeter';

function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/password-reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not reset password');
      setDone(true);
      setTimeout(() => router.push('/login'), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return <p style={{ color: 'var(--chalk-muted)' }}>Missing reset token — use the link from your email.</p>;
  }

  if (done) {
    return <p style={{ color: 'var(--chalk-muted)' }}>Password updated. Redirecting to log in…</p>;
  }

  return (
    <form onSubmit={onSubmit}>
      <PasswordField
        id="password"
        label="New password"
        value={password}
        onChange={setPassword}
        minLength={8}
        placeholder="At least 8 characters"
        autoComplete="new-password"
      />
      <PasswordStrengthMeter password={password} />
      <PasswordField
        id="confirmPassword"
        label="Confirm new password"
        value={confirmPassword}
        onChange={setConfirmPassword}
        minLength={8}
        placeholder="Re-enter your new password"
        autoComplete="new-password"
      />
      {error && <div className="error-text">{error}</div>}
      <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
        {loading ? 'Updating…' : 'Set new password'}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <>
      <Header />
      <section className="section" style={{ display: 'flex', justifyContent: 'center' }}>
        <div className="card" style={{ width: 400, maxWidth: '100%' }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>ACCOUNT RECOVERY</div>
          <h1 className="display" style={{ fontSize: 26, marginBottom: 24 }}>Set a new password</h1>
          <Suspense fallback={<p>Loading…</p>}>
            <ResetPasswordForm />
          </Suspense>
        </div>
      </section>
      <Footer />
    </>
  );
}
