'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface SidebarItem {
  href: string;
  label: string;
  /** Use exact-match highlighting instead of startsWith — set this on index/overview routes so e.g. /admin doesn't stay highlighted while viewing /admin/plans. */
  exact?: boolean;
}

export default function Sidebar({ title, items }: { title: string; items: SidebarItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="sidebar" aria-label={title}>
      <div className="sidebar-title">{title}</div>
      {items.map((item) => {
        const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link key={item.href} href={item.href} className={`sidebar-link${active ? ' sidebar-link-active' : ''}`}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
