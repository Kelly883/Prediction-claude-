import Link from 'next/link';
import { breadcrumbJsonLd } from '@/lib/seo/structured-data';

interface Breadcrumb {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: Breadcrumb[];
}

export function Breadcrumbs({ items }: BreadcrumbsProps) {
  const jsonLd = breadcrumbJsonLd(
    items.map((item) => ({ name: item.label, href: item.href || '#' }))
  );

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <nav aria-label="Breadcrumb" className="text-sm mb-6" style={{ color: 'var(--chalk-muted)' }}>
        <ol className="flex flex-wrap items-center gap-2">
          {items.map((item, index) => (
            <li key={index} className="flex items-center gap-2">
              {index > 0 && <span style={{ color: 'var(--chalk-muted)' }}>/</span>}
              {item.href && index < items.length - 1 ? (
                <Link href={item.href} className="hover:underline" style={{ color: 'var(--chalk-muted)' }}>
                  {item.label}
                </Link>
              ) : (
                <span style={{ color: 'var(--chalk)' }} aria-current="page">
                  {item.label}
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}
