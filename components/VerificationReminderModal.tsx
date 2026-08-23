'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiJson } from '@/lib/api-client';

type Props = {
  openIntervalMs?: number;
};

export default function VerificationReminderModal({ openIntervalMs = 300000 }: Props) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let mounted = true;

    async function load() {
      try {
        const me = await apiJson<{ email: string; emailVerified: boolean }>('/api/me');
        if (!mounted) return;
        if (!me.emailVerified) {
          setEmail(me.email);
          setOpen(true);
          timer = setInterval(() => {
            if (mounted) setOpen(true);
          }, openIntervalMs);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();

    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, [openIntervalMs]);

  function dismiss() {
    setOpen(false);
  }

  async function resend() {
    if (!email) return;
    await apiJson('/api/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    dismiss();
  }

  function changeEmail() {
    dismiss();
    router.push('/dashboard/profile');
  }

  if (loading || !open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 43, 29, 0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: 24,
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: 480,
          width: '100%',
          borderColor: 'var(--floodlight)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 20, marginBottom: 8, fontFamily: 'var(--font-display)' }}>Verify your email address</h2>
          <p style={{ color: 'var(--chalk-muted)', fontSize: 14, lineHeight: 1.6 }}>
            We sent a verification link to <strong style={{ color: 'var(--chalk)' }}>{email}</strong>.
            Please verify to unlock all features and secure your account.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            onClick={resend}
            className="btn btn-primary"
            style={{ width: '100%', textAlign: 'center' }}
          >
            Resend verification email
          </button>
          <button
            onClick={changeEmail}
            className="btn btn-ghost"
            style={{ width: '100%', textAlign: 'center', display: 'block' }}
          >
            Change email address
          </button>
          <button
            onClick={dismiss}
            className="btn btn-ghost"
            style={{ width: '100%', textAlign: 'center', color: 'var(--chalk-muted)' }}
          >
            Remind me later
          </button>
        </div>
      </div>
    </div>
  );
}
