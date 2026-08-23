'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardHeader from '@/components/DashboardHeader';
import AdminNavTabs from '@/components/AdminNavTabs';
import { DashboardUserProvider, useDashboardUser } from '@/lib/dashboard-user-context';
import { apiJson } from '@/lib/api-client';
import VerificationReminderModal from '@/components/VerificationReminderModal';

function VerificationBanner() {
  const { user } = useDashboardUser();
  const [resending, setResending] = useState(false);
  const [sent, setSent] = useState(false);

  if (!user?.email || user.emailVerified) return null;

  const email = user.email;

  async function resend() {
    setResending(true);
    try {
      await apiJson('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } finally {
      setResending(false);
    }
  }

  return (
    <div
      className="card"
      style={{ marginBottom: 24, borderColor: 'var(--floodlight)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}
    >
      <div>
        <p style={{ fontWeight: 600, marginBottom: 4 }}>Verify your email address</p>
        <p style={{ color: 'var(--chalk-muted)', fontSize: 13 }}>
                  {sent ? 'Check your inbox for a new link.' : `We haven't confirmed ${email} yet.`}
        </p>
      </div>
      <button
        onClick={resend}
        disabled={resending || sent}
        className="btn btn-ghost"
        style={{ flexShrink: 0 }}
      >
        {sent ? 'Sent ✓' : resending ? 'Sending…' : 'Resend verification email'}
      </button>
    </div>
  );
}

function AdminChrome({ children }: { children: React.ReactNode }) {
  const { user, loading } = useDashboardUser();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user && user.role !== 'admin' && user.role !== 'superadmin') {
      router.replace('/dashboard');
    }
  }, [user, loading, router]);

  if (!loading && user && user.role !== 'admin' && user.role !== 'superadmin') {
    return (
      <div className="p-8 text-center text-sm text-[var(--chalk-muted)]">
        Redirecting to Member Dashboard…
      </div>
    );
  }

  return (
    <>
      <DashboardHeader isAdmin />
      <section className="section-tight">
        <div className="container admin-overview-shell">
          <div className="admin-nav-tabs-wrapper mb-5">
            <AdminNavTabs permissions={user?.permissions} />
          </div>
          <VerificationBanner />
          <div className="dashboard-content">{children}</div>
        </div>
      </section>
      <VerificationReminderModal />
    </>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardUserProvider>
      <AdminChrome>{children}</AdminChrome>
    </DashboardUserProvider>
  );
}
