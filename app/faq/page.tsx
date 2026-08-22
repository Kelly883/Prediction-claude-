import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { getCmsSections } from '@/lib/cms';

export const metadata = { title: 'FAQ — PredictPro' };
export const dynamic = 'force-dynamic';

// Same CMS convention as /terms and /privacy: { heading?, body? } blocks
// under page="faq", editable at /admin/cms.
export default async function FaqPage() {
  const sections = await getCmsSections('faq');
  const keys = Object.keys(sections);

  return (
    <>
      <Header />
      <section className="section">
        <div className="container" style={{ maxWidth: 720 }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>QUESTIONS</div>
          <h1 className="display" style={{ fontSize: 36, marginBottom: 24 }}>FAQ</h1>

          {keys.length === 0 ? (
            <p style={{ color: 'var(--chalk-muted)' }}>
              This page is managed from the admin CMS and hasn&apos;t been published yet.
            </p>
          ) : (
            keys.map((key) => {
              const block = sections[key] as { heading?: string; body?: string };
              return (
                <div key={key} style={{ marginBottom: 28 }}>
                  {block.heading && <h2 style={{ fontSize: 18, marginBottom: 8 }}>{block.heading}</h2>}
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
