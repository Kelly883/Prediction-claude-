'use client';

import { useEffect, useRef } from 'react';
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
  const activeRef = useRef<HTMLAnchorElement>(null);
  const containerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // Scroll active item into view on mobile horizontally
    if (activeRef.current && containerRef.current) {
      const container = containerRef.current;
      const el = activeRef.current;
      const elLeft = el.offsetLeft;
      const elWidth = el.offsetWidth;
      const containerWidth = container.offsetWidth;
      container.scrollTo({
        left: elLeft - containerWidth / 2 + elWidth / 2,
        behavior: 'smooth',
      });
    }
  }, [pathname]);

  return (
    <nav className="sidebar" aria-label={title} ref={containerRef}>
      <div className="sidebar-title">{title}</div>
      <div className="sidebar-links-wrapper">
        {items.map((item) => {
          const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              ref={active ? activeRef : undefined}
              className={`sidebar-link${active ? ' sidebar-link-active' : ''}`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

