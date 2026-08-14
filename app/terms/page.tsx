import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { getCmsSections } from '@/lib/cms';

// Queries the DB directly (no static content to prerender at build time,
// and no DB connection guaranteed to exist during CI/build anyway).
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Terms of Service — PredictPro' };

// CMS-controlled per PRD Section 10. Convention: each CmsSection row under
// page="terms" has content shaped { heading?: string; body?: string }.
export default async function TermsPage() {
  const sections = await getCmsSections('terms');
  const keys = Object.keys(sections);

  return (
    <>
      <Header />
      <section className="section">
        <div className="container" style={{ maxWidth: 720 }}>
          <h1 className="display" style={{ fontSize: 36, marginBottom: 24 }}>Terms of Service</h1>

          {keys.length === 0 ? (
            <p style={{ color: 'var(--chalk-muted)' }}>
              This page is managed from the admin CMS and hasn't been published yet.
            </p>
          ) : (
            keys.map((key) => {
              const block = sections[key] as { heading?: string; body?: string };
              return (
                <div key={key} style={{ marginBottom: 32 }}>
                  {block.heading && <h2 style={{ fontSize: 20, marginBottom: 8 }}>{block.heading}</h2>}
                  {block.body && <p style={{ color: 'var(--chalk-muted)', lineHeight: 1.7 }}>{block.body}</p>}
                </div>
              );
            })
          )}
        </div>
      </section>
      <Footer />
    </>
  );
}
