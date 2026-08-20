'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const ADMIN_NAV_LINKS = [
  { href: '/admin', label: 'Overview', exact: true },
  { href: '/admin/plans', label: 'Plans' },
  { href: '/admin/predictions', label: 'Predictions' },
  { href: '/admin/free-access', label: 'Free Access' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/transactions', label: 'Transactions' },
  { href: '/admin/audit-logs', label: 'Audit Logs' },
  { href: '/admin/cms', label: 'CMS' },
  { href: '/admin/security', label: 'Security' },
];

export default function AdminNavTabs() {
  const pathname = usePathname();

  return (
    <nav className="admin-dash-tabs" aria-label="Admin Navigation">
      {ADMIN_NAV_LINKS.map((item) => {
        const isActive = item.exact 
          ? pathname === item.href 
          : pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`admin-dash-tab ${isActive ? 'admin-dash-tab-active' : ''}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
