'use client';

import DashboardHeader from '@/components/DashboardHeader';
import Sidebar from '@/components/Sidebar';
import { DashboardUserProvider, useDashboardUser } from '@/lib/dashboard-user-context';

const USER_LINKS = [
  { href: '/dashboard', label: 'Overview', exact: true },
  { href: '/dashboard/plans', label: 'Plans' },
  { href: '/dashboard/profile', label: 'Profile' },
  { href: '/dashboard/security', label: 'Security' },
];

function DashboardChrome({ children }: { children: React.ReactNode }) {
  const { user } = useDashboardUser();
  return (
    <>
      <DashboardHeader isAdmin={user?.role === 'admin'} />
      <section className="section-tight">
        <div className="container dashboard-shell">
          <Sidebar title="Account" items={USER_LINKS} />
          <div className="dashboard-content">{children}</div>
        </div>
      </section>
    </>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardUserProvider>
      <DashboardChrome>{children}</DashboardChrome>
    </DashboardUserProvider>
  );
}
