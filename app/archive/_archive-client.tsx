'use client';

import { useRouter, usePathname } from 'next/navigation';

type Plan = {
  id: string;
  name: string;
};

type Post = {
  id: string;
  title: string;
  scheduledAt: string;
  outcome: 'won' | 'lost';
  updatedAt: string;
  bookingCode: string;
  items: Array<{ match: string; prediction: string }>;
};

type Stats = {
  total: number;
  won: number;
  lost: number;
  winRate: number;
};

type Props = {
  plans: Plan[];
  selectedPlanId: string | null;
  selectedPlan?: { id: string; name: string };
  error: string | null;
  posts: Post[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  stats: Stats;
};

function statusStyle(outcome: string) {
  const isWon = outcome === 'won';
  return {
    background: isWon ? 'rgba(24, 201, 100, 0.10)' : 'rgba(193, 68, 59, 0.10)',
    color: isWon ? '#18C964' : '#c1443b',
    borderColor: isWon ? 'rgba(24, 201, 100, 0.25)' : 'rgba(193, 68, 59, 0.25)',
  };
}

function formatDate(value: string) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ArchiveClient({
  plans,
  selectedPlanId,
  selectedPlan,
  error,
  posts,
  total,
  page,
  pageSize,
  hasMore,
  stats,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  // `isPending` is present on the Next.js router at runtime; the bundled types
  // lag the runtime surface, so we read it defensively.
  const pending: boolean = (router as { isPending?: boolean }).isPending === true;

  const selectPlan = (id: string) => {
    router.replace(`?plan=${encodeURIComponent(id)}`, { scroll: false });
  };

  const changePage = (nextPage: number) => {
    const params = selectedPlanId
      ? `?plan=${encodeURIComponent(selectedPlanId)}&page=${nextPage}`
      : `?page=${nextPage}`;
    router.replace(params, { scroll: false });
  };

  const resetToDefault = () => {
    router.replace(pathname, { scroll: false });
  };

  const hasPlans = plans.length > 0;

  if (pending) {
    return (
      <div style={{ padding: '40px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, color: 'var(--chalk-muted)' }}>
        <div style={{ height: 120, width: '100%', maxWidth: 360, background: 'var(--turf)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 12, padding: 20 }}>
          <div style={{ height: 18, width: '40%', background: 'rgba(255,255,255,0.06)', borderRadius: 4 }} />
          <div style={{ height: 14, width: '25%', background: 'rgba(255,255,255,0.06)', borderRadius: 4 }} />
          <div style={{ height: 120, width: '100%', background: 'rgba(255,255,255,0.03)', borderRadius: 6 }} />
        </div>
        <p style={{ margin: 0, fontSize: 14 }}>Loading archive…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--chalk-muted)' }}>
        <p style={{ fontSize: 16, color: '#c1443b', margin: '0 0 12px' }}>{error}</p>
        <button
          onClick={resetToDefault}
          style={{
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.2)',
            color: 'var(--chalk)',
            padding: '8px 16px',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Reset to default plan
        </button>
      </div>
    );
  }

  if (!hasPlans) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--chalk-muted)' }}>
        <p style={{ fontSize: 16, margin: '0 0 8px' }}>No subscription plans available.</p>
        <p style={{ fontSize: 14, margin: 0 }}>
          Archive results will appear once plans and published predictions exist.
        </p>
      </div>
    );
  }

  const planName = selectedPlan?.name ?? (plans.find((p) => p.id === selectedPlanId)?.name ?? 'this plan');

  if (posts.length === 0 && !error) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--chalk-muted)' }}>
        <p style={{ fontSize: 16, margin: '0 0 8px', color: 'var(--chalk)' }}>
          No historical predictions for {planName}.
        </p>
        <p style={{ fontSize: 14, margin: 0 }}>Results will appear here as matchdays conclude.</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 26, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={{ fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.18em', fontSize: 12, color: '#18C964', fontWeight: 600, margin: 0 }}>
          Archive
        </p>
        <h1 style={{ fontSize: 'clamp(28px, 5vw, 44px)', lineHeight: 1.1, fontWeight: 800, color: '#FFFFFF', margin: 0 }}>
          Prediction Archive
        </h1>
        <p style={{ maxWidth: 640, marginTop: 10, fontSize: 15, color: 'var(--chalk-muted)', lineHeight: 1.6 }}>
          Inspect historical prediction performance. Select a subscription plan to view only the
          won/lost records published for that plan.
        </p>
      </div>

      {/* Plan selector */}
      <div style={{ marginBottom: 26 }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--chalk-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 10px', fontFamily: 'var(--font-mono)' }}>
          Select plan
        </p>
        <div
          style={{
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            paddingBottom: 6,
            scrollbarWidth: 'none',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {plans.map((plan) => {
            const active = selectedPlanId === plan.id;
            const style = active
              ? {
                  background: '#F5B335',
                  color: '#0a2116',
                  borderColor: '#F5B335',
                }
              : {
                  background: 'transparent',
                  color: 'var(--chalk-muted)',
                  borderColor: 'rgba(255,255,255,0.12)',
                };
            return (
              <button
                key={plan.id}
                onClick={() => selectPlan(plan.id)}
                style={{
                  whiteSpace: 'nowrap',
                  padding: '8px 14px',
                  borderRadius: 4,
                  border: `1px solid ${style.borderColor}`,
                  background: style.background,
                  color: style.color,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-display)',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={() => {}}
              >
                {plan.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Performance summary */}
      <div
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          marginBottom: 26,
        }}
      >
        {[
          { label: 'Settled predictions', value: stats.total.toString(), key: 'total' },
          { label: 'Won', value: stats.won.toString(), key: 'won' },
          { label: 'Lost', value: stats.lost.toString(), key: 'lost' },
          { label: 'Win rate', value: `${stats.winRate}%`, key: 'rate' },
        ].map((card) => (
          <div
            key={card.key}
            style={{
              background: 'var(--turf)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8,
              padding: '16px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--chalk-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
              {card.label}
            </p>
            <p style={{ fontSize: 26, fontWeight: 800, color: '#FFFFFF', lineHeight: 1.1, margin: 0, fontFamily: 'var(--font-display)' }}>
              {card.value}
            </p>
          </div>
        ))}
      </div>

      {/* Archive cards */}
      <div
        style={{
          display: 'grid',
          gap: 14,
          gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))',
        }}
      >
        {posts.map((post) => {
          const s = statusStyle(post.outcome);
          return (
            <article
              key={post.id}
              style={{
                background: 'var(--turf)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8,
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: 'var(--chalk-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      fontFamily: 'var(--font-mono)',
                      margin: 0,
                    }}
                  >
                    {formatDate(post.scheduledAt)}
                  </span>
                  <h3
                    style={{
                      fontSize: 17,
                      fontWeight: 800,
                      color: '#FFFFFF',
                      lineHeight: 1.2,
                      margin: '0 0 2px',
                      fontFamily: 'var(--font-display)',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {post.title}
                  </h3>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    letterSpacing: '0.12em',
                    padding: '4px 10px',
                    borderRadius: 6,
                    background: s.background,
                    color: s.color,
                    border: `1px solid ${s.borderColor}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {post.outcome.toUpperCase()}
                </span>
              </div>

              {post.bookingCode && post.bookingCode.toLowerCase() !== 'none' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                  <span style={{ fontSize: 12, color: 'var(--chalk-muted)', fontFamily: 'var(--font-mono)', margin: 0 }}>Booking code</span>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: '#F5B335',
                      fontFamily: 'var(--font-mono)',
                      margin: 0,
                    }}
                  >
                    {post.bookingCode}
                  </span>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 8 }}>
                {post.items.map((item) => (
                  <div
                    key={item.match}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      gap: 8,
                      padding: '5px 0',
                      borderBottom: item.match !== post.items[post.items.length - 1].match ? '1px solid rgba(255,255,255,0.04)' : 'none',
                      fontSize: 14,
                    }}
                  >
                    <span
                      style={{
                        color: '#FFFFFF',
                        fontWeight: 600,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.match}
                    </span>
                    <span
                      style={{
                        color: 'var(--chalk-muted)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 13,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.prediction}
                    </span>
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </div>

      {/* Pagination */}
      {total > pageSize && (
        <div
          style={{
            marginTop: 30,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
            paddingTop: 16,
            borderTop: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <p style={{ fontSize: 13, color: 'var(--chalk-muted)', margin: 0, fontFamily: 'var(--font-mono)' }}>
            Showing {Math.min(pageSize, total)} of {total}
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            {page > 1 && (
              <button
                onClick={() => changePage(page - 1)}
                disabled={page <= 1}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: 'var(--chalk)',
                  padding: '6px 12px',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  opacity: page <= 1 ? 0.4 : 1,
                }}
              >
                Prev
              </button>
            )}
            <span
              style={{
                fontSize: 13,
                color: 'var(--chalk-muted)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              Page {page}
            </span>
            {hasMore && (
              <button
                onClick={() => changePage(page + 1)}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: 'var(--chalk)',
                  padding: '6px 12px',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Next
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
