import { Metadata } from 'next';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { buildMetadata } from '@/lib/seo/metadata';
import { breadcrumbJsonLd, ORG_JSON_LD } from '@/lib/seo/structured-data';
import ArchiveClient from './_archive-client';

export const metadata: Metadata = buildMetadata({
  title: 'Prediction Archive — PredictPro',
  description: 'Inspect historical football prediction performance by subscription plan. Transparent won/lost results with booking codes.',
  pathname: '/archive',
});

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

type PageProps = {
  searchParams: Promise<{ plan?: string }>;
};

export default async function PublicArchivePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const planParam = params.plan;

  const plans = await prisma.plan.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  const defaultPlanId = plans[0]?.id ?? null;
  const selectedPlan = planParam ? plans.find((p) => p.id === planParam) : null;
  const selectedPlanId = selectedPlan ? selectedPlan.id : defaultPlanId;
  const invalidPlan = Boolean(planParam) && !selectedPlan;

  let posts: any[] = [];
  let totalRecords = 0;
  let stats = { total: 0, won: 0, lost: 0, winRate: 0 };
  let error: string | null = null;

  if (invalidPlan) {
    error = 'That subscription plan is not available.';
  } else if (selectedPlanId) {
    const baseWhere: Prisma.PredictionPostWhereInput = {
      status: 'archived',
      outcome: { in: ['won', 'lost'] },
      planIds: { has: selectedPlanId },
    };
    [posts, totalRecords] = await Promise.all([
      prisma.predictionPost.findMany({
        where: baseWhere,
        orderBy: { updatedAt: 'desc' },
        skip: 0,
        take: PAGE_SIZE,
        select: {
          id: true,
          title: true,
          scheduledAt: true,
          outcome: true,
          updatedAt: true,
          bookingCode: true,
          items: {
            select: { match: true, prediction: true },
            orderBy: { matchDateTime: 'asc' },
          },
        },
      }),
      prisma.predictionPost.count({ where: baseWhere }),
    ]);

    // Statistics cover the ENTIRE selected-plan archive, not just the
    // paginated page of records. Use dedicated count queries over the full
    // filtered dataset so win rate / won / lost are correct regardless of how
    // many records are displayed per page.
    const [wonCount, lostCount] = await Promise.all([
      prisma.predictionPost.count({ where: { ...baseWhere, outcome: 'won' } }),
      prisma.predictionPost.count({ where: { ...baseWhere, outcome: 'lost' } }),
    ]);

    const settled = wonCount + lostCount;
    stats = {
      total: settled,
      won: wonCount,
      lost: lostCount,
      winRate: settled ? Math.round((wonCount / settled) * 100) : 0,
    };
  }

  const breadcrumbs = breadcrumbJsonLd([
    { name: 'Home', href: '/' },
    { name: 'Prediction Archive', href: '/archive' },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ORG_JSON_LD) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }}
      />

      <Header />

      <section style={{ background: 'var(--pitch)' }}>
        <div style={{ padding: '56px 0 40px' }}>
          <ArchiveClient
            plans={plans}
            selectedPlanId={selectedPlanId}
            selectedPlan={selectedPlan ?? undefined}
            error={error}
            posts={posts}
            total={totalRecords}
            page={1}
            pageSize={PAGE_SIZE}
            hasMore={totalRecords > PAGE_SIZE}
            stats={stats}
          />
        </div>
      </section>

      <Footer />
    </>
  );
}
