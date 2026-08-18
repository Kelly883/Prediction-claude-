'use client';

import { useState } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import PasswordField from '@/components/PasswordField';
import PasswordStrengthMeter from '@/components/PasswordStrengthMeter';

const COUNTRIES = [
  { code: 'NG', label: 'Nigeria' },
  { code: 'GH', label: 'Ghana' },
  { code: 'KE', label: 'Kenya' },
  { code: 'ZA', label: 'South Africa' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'US', label: 'United States' },
  { code: 'OTHER', label: 'Other' },
];

type RegistrationState = 'form' | 'pending' | 'error';

export default function RegisterPage() {
  const [state, setState] = useState<RegistrationState>('form');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [country, setCountry] = useState('NG');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState<string>('');
  const [emailSent, setEmailSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }

    setLoading(true);
    try {
      const registerRes = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, password, country }),
      });
      const registerData = await registerRes.json();
      if (!registerRes.ok) throw new Error(registerData.error ?? 'Couldn\u2019t create your account');

      setRegisteredEmail(registerData.email);
      setEmailSent(registerData.emailSent ?? false);
      setState('pending');
    } catch (err) {
      setState('error');
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (state === 'pending') {
    return (
      <>
        <Header />
        <section className="section" style={{ display: 'flex', justifyContent: 'center' }}>
          <div className="card" style={{ width: 400, maxWidth: '100%', textAlign: 'center' }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>CHECK YOUR INBOX</div>
            <h1 className="display" style={{ fontSize: 26, marginBottom: 12 }}>Verify your email</h1>
            <p style={{ color: 'var(--chalk-muted)', marginBottom: 6 }}>
              We sent a verification link to <strong>{registeredEmail}</strong>
            </p>
            <p style={{ color: 'var(--chalk-muted)', marginBottom: 20, fontSize: 14 }}>
              Click the link in that email to activate your account. If you don&apos;t see it, check your spam folder.
            </p>
            {!emailSent && (
              <p style={{ color: 'var(--card-red)', marginBottom: 20, fontSize: 13 }}>
                We couldn&apos;t send the verification email automatically. Please contact support or try registering again.
              </p>
            )}
            <Link href="/login" className="btn btn-primary" style={{ width: '100%' }}>
              Go to login
            </Link>
          </div>
        </section>
        <Footer />
      </>
    );
  }

  if (state === 'error') {
    return (
      <>
        <Header />
        <section className="section" style={{ display: 'flex', justifyContent: 'center' }}>
          <div className="card" style={{ width: 400, maxWidth: '100%' }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>SOMETHING WENT WRONG</div>
            <h1 className="display" style={{ fontSize: 26, marginBottom: 24 }}>Sign up</h1>
            <div className="error-text" style={{ marginBottom: 16 }}>{error}</div>
            <button type="button" className="btn btn-primary" style={{ width: '100%' }} onClick={() => setState('form')}>
              Try again
            </button>
          </div>
        </section>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Header />
      <section className="section" style={{ display: 'flex', justifyContent: 'center' }}>
        <div className="card" style={{ width: 400, maxWidth: '100%' }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>NEW ACCOUNT</div>
          <h1 className="display" style={{ fontSize: 26, marginBottom: 24 }}>Sign up</h1>

          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="name">Full name</label>
              <input id="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
            </div>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div className="field">
              <label htmlFor="phone">Phone number</label>
              <input id="phone" type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+234 800 000 0000" />
            </div>
            <PasswordField
              id="password"
              label="Password"
              value={password}
              onChange={setPassword}
              minLength={8}
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
            <PasswordStrengthMeter password={password} />
            <PasswordField
              id="confirmPassword"
              label="Confirm password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              minLength={8}
              placeholder="Re-enter your password"
              autoComplete="new-password"
            />
            <div className="field">
              <label htmlFor="country">Country</label>
              <select
                id="country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                style={{
                  background: 'var(--pitch)',
                  border: '1px solid rgba(243,245,236,0.14)',
                  borderRadius: 4,
                  padding: '12px 14px',
                  color: 'var(--chalk)',
                  fontSize: 15,
                }}
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </select>
            </div>

            {error && <div className="error-text">{error}</div>}

            <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <p style={{ marginTop: 20, fontSize: 14, color: 'var(--chalk-muted)' }}>
            Already have an account? <Link href="/login" style={{ color: 'var(--floodlight)' }}>Log in</Link>
          </p>
        </div>
      </section>
      <Footer />
    </>
  );
}
