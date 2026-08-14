'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import PasswordField from '@/components/PasswordField';
import PasswordStrengthMeter from '@/components/PasswordStrengthMeter';
import { ShieldCheck, Lock, AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';

const COUNTRIES = [
  { code: 'NG', label: 'Nigeria' },
  { code: 'GH', label: 'Ghana' },
  { code: 'KE', label: 'Kenya' },
  { code: 'ZA', label: 'South Africa' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'US', label: 'United States' },
  { code: 'OTHER', label: 'Other' },
];

export default function AdminSetupPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [isSetupAvailable, setIsSetupAvailable] = useState<boolean | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [country, setCountry] = useState('NG');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [setupCompleted, setSetupCompleted] = useState(false);

  useEffect(() => {
    async function checkStatus() {
      try {
        const res = await fetch('/api/auth/admin-setup');
        const data = await res.json();
        setIsSetupAvailable(data.isSetupAvailable);
      } catch (err) {
        setIsSetupAvailable(false);
      } finally {
        setChecking(false);
      }
    }
    checkStatus();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/admin-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, password, country }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? 'Failed to initialize admin account');
      }

      setSetupCompleted(true);
      setTimeout(() => {
        router.push('/admin');
        router.refresh();
      }, 1500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Header />
      <main className="section" style={{ minHeight: 'calc(100vh - 140px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 16px' }}>
        <div className="card" style={{ width: 440, maxWidth: '100%', border: '1px solid rgba(245, 179, 53, 0.25)', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)' }}>
          {checking ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--chalk-muted)' }}>
              <div style={{ display: 'inline-block', width: 28, height: 28, border: '3px solid rgba(245, 179, 53, 0.2)', borderTopColor: '#F5B335', borderRadius: '50%', animation: 'spin 1s linear infinite', marginBottom: 12 }} />
              <p style={{ fontSize: 14 }}>Verifying admin provisioning status...</p>
            </div>
          ) : setupCompleted ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(118, 184, 128, 0.16)', border: '1px solid #76B880', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: '#76B880' }}>
                <CheckCircle2 size={32} />
              </div>
              <h1 className="display" style={{ fontSize: 24, marginBottom: 8, color: '#FFFFFF' }}>Admin Account Created!</h1>
              <p style={{ fontSize: 14, color: 'var(--chalk-muted)', marginBottom: 20 }}>
                Initial administrator credentials have been securely provisioned. Redirecting to the Admin Portal...
              </p>
              <div style={{ fontSize: 13, color: '#F5B335', fontWeight: 600 }}>
                Initial setup portal is now permanently deactivated.
              </div>
            </div>
          ) : !isSetupAvailable ? (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(245, 179, 53, 0.12)', border: '1px solid rgba(245, 179, 53, 0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: '#F5B335' }}>
                <Lock size={28} />
              </div>
              <div className="eyebrow" style={{ color: '#F5B335', marginBottom: 6, letterSpacing: '0.12em' }}>
                SETUP INACTIVE
              </div>
              <h1 className="display" style={{ fontSize: 22, marginBottom: 12, color: '#FFFFFF' }}>
                Admin Account Already Configured
              </h1>
              <p style={{ fontSize: 14, color: 'var(--chalk-muted)', lineHeight: 1.6, marginBottom: 24 }}>
                The one-time administrator account has already been created for this system. For platform security, initial setup is permanently deactivated and no additional admin accounts can be self-registered.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Link
                  href="/login?next=/admin"
                  className="btn btn-primary"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    padding: '12px 20px',
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  Log In to Admin Portal
                  <ArrowRight size={16} />
                </Link>
                <Link
                  href="/"
                  className="btn btn-secondary"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '10px 20px',
                    fontSize: 13,
                  }}
                >
                  Return to Home
                </Link>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <ShieldCheck size={18} style={{ color: '#F5B335' }} />
                <span className="eyebrow" style={{ color: '#F5B335', letterSpacing: '0.12em', fontSize: 11 }}>
                  ONE-TIME ADMIN INITIALIZATION
                </span>
              </div>

              <h1 className="display" style={{ fontSize: 24, marginBottom: 8 }}>
                Create Administrator
              </h1>

              <div
                style={{
                  background: 'rgba(245, 179, 53, 0.08)',
                  border: '1px solid rgba(245, 179, 53, 0.25)',
                  borderRadius: 6,
                  padding: '10px 12px',
                  fontSize: 12,
                  color: 'var(--chalk)',
                  lineHeight: 1.5,
                  marginBottom: 20,
                }}
              >
                <strong>Security Notice:</strong> This initial setup portal is only available once. After this administrator account is registered, this setup page and its header link will be permanently removed.
              </div>

              {error && (
                <div
                  style={{
                    background: 'rgba(226, 75, 75, 0.15)',
                    border: '1px solid rgba(226, 75, 75, 0.4)',
                    color: '#ff8a8a',
                    padding: '10px 12px',
                    borderRadius: 6,
                    fontSize: 13,
                    marginBottom: 16,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={onSubmit}>
                <div className="field">
                  <label htmlFor="name">Admin full name</label>
                  <input
                    id="name"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="E.g. Kelly Admin"
                  />
                </div>

                <div className="field">
                  <label htmlFor="email">Admin email</label>
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@predictpro.com"
                  />
                </div>

                <div className="field">
                  <label htmlFor="phone">Phone number</label>
                  <input
                    id="phone"
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+234 800 000 0000"
                  />
                </div>

                <div className="field">
                  <label htmlFor="country">Country</label>
                  <select
                    id="country"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                <PasswordField
                  id="password"
                  label="Master password"
                  value={password}
                  onChange={setPassword}
                  minLength={8}
                  placeholder="At least 8 characters"
                />
                <PasswordStrengthMeter password={password} />

                <div style={{ marginTop: 14 }}>
                  <PasswordField
                    id="confirmPassword"
                    label="Confirm master password"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    minLength={8}
                    placeholder="Re-enter master password"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="btn btn-primary"
                  style={{
                    width: '100%',
                    marginTop: 24,
                    padding: '12px 18px',
                    fontSize: 14,
                    fontWeight: 700,
                  }}
                >
                  {loading ? 'Provisioning Admin...' : 'Create Admin & Launch Portal'}
                </button>
              </form>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
