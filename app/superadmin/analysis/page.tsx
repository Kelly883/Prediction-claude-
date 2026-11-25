import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { verifyAccessToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export default async function SuperAdminAnalysisPage() {
  // Server-side superadmin authorization: direct URL access is protected.
  const cookieStore = await cookies();
  const token = cookieStore.get('access_token')?.value;

  if (!token) {
    redirect('/login');
  }

  const payload = await verifyAccessToken(token);
  if (!payload || payload.role !== 'superadmin') {
    redirect('/dashboard');
  }

  const [runs, results, configs] = await Promise.all([
    prisma.analysisRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { _count: { select: { results: true } } },
    }),
    prisma.analysisResult.findMany({
      orderBy: [{ confidence: 'desc' }, { kickoff: 'asc' }],
      take: 10,
    }),
    prisma.analysisConfig.findMany({ orderBy: { key: 'asc' } }),
  ]);

  return (
    <div className="admin-audit-shell">
      <div className="admin-audit-header">
        <div className="admin-page-eyebrow">Analysis</div>
        <h1 className="admin-audit-title">Analysis Runs</h1>
        <p className="admin-audit-subtitle">Superadmin analysis runs and results.</p>
        <div className="admin-underline" />
      </div>

      <div className="admin-analysis-summary">
        <div className="card">
          <p className="admin-summary-label">Total Runs</p>
          <p className="admin-summary-value">{runs.length}</p>
        </div>
        <div className="card">
          <p className="admin-summary-label">Results</p>
          <p className="admin-summary-value">{results.length}</p>
        </div>
        <div className="card">
          <p className="admin-summary-label">Configuration Keys</p>
          <p className="admin-summary-value">{configs.length}</p>
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="admin-audit-empty">
          <p className="admin-audit-empty-title">No analysis runs</p>
          <p className="admin-audit-empty-subtitle">
            Run the daily analysis to generate predictions.
          </p>
        </div>
      ) : (
        <section className="admin-analysis-section">
          <h2 className="admin-section-title">Recent Analysis Runs</h2>
          <pre className="admin-json-preview">{JSON.stringify(runs, null, 2)}</pre>
        </section>
      )}

      {results.length > 0 && (
        <section className="admin-analysis-section">
          <h2 className="admin-section-title">Available Analysis Results</h2>
          <pre className="admin-json-preview">{JSON.stringify(results, null, 2)}</pre>
        </section>
      )}

      {configs.length > 0 && (
        <section className="admin-analysis-section">
          <h2 className="admin-section-title">Current Configuration</h2>
          <pre className="admin-json-preview">{JSON.stringify(configs, null, 2)}</pre>
        </section>
      )}
    </div>
  );
}
