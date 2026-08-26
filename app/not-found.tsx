import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { buildMetadata } from '@/lib/seo/metadata';
import { breadcrumbJsonLd } from '@/lib/seo/structured-data';

export const metadata = buildMetadata({
  title: 'Page not found — PredictPro',
  description: 'The page you are looking for does not exist.',
  pathname: '/',
  noIndex: true,
});

export default function NotFoundPage() {
  const breadcrumbs = breadcrumbJsonLd([
    { name: 'Home', href: '/' },
    { name: '404', href: '#' },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }}
      />
      <Header />
      <section className="section" style={{ padding: '80px 0' }}>
        <div className="container" style={{ textAlign: 'center', maxWidth: 480 }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>ERROR 404</div>
          <h1 className="display" style={{ fontSize: 48, marginBottom: 16 }}>Page not found</h1>
          <p style={{ color: 'var(--chalk-muted)', marginBottom: 32, lineHeight: 1.6 }}>
            The page you are looking for does not exist or has been moved.
          </p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/" className="btn btn-primary">Back to home</Link>
            <Link href="/football-predictions" className="btn btn-ghost">Football predictions</Link>
            <Link href="/faq" className="btn btn-ghost">FAQ</Link>
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}
