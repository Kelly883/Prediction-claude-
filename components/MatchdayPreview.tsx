'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Calendar, ChevronRight } from 'lucide-react';

// Shape returned by GET /api/public/fixtures (see app/api/public/fixtures/route.ts).
// The endpoint returns post-level fields plus a small `items[]` array; it does
// NOT return team objects, competition logos, kickoff, or prediction data.
// Every field except `id` is treated as optional so a partial/older payload can
// never crash rendering.
type FixtureItem = {
  id?: string;
  match?: string;
  matchDateTime?: string;
};

type Fixture = {
  id: string;
  title?: string;
  scheduledAt?: string;
  status?: string;
  matchCount?: number;
  items?: FixtureItem[];
  // Optional / forward-compatible only. Not provided by the public endpoint
  // today; rendered only when actually present.
  league?: { name?: string; logo?: string };
  homeTeam?: { name?: string; logo?: string };
  awayTeam?: { name?: string; logo?: string };
  prediction?: {
    market?: string;
    selection?: string;
    odds?: number;
    confidence?: number;
  };
  result?: 'won' | 'lost' | 'pending';
};

type FixtureCardProps = {
  fixture: Fixture;
  isEntitled: boolean;
};

function formatDateTime(value?: string): { time: string; date: string } {
  if (!value) return { time: '', date: '' };
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { time: '', date: '' };
  return {
    time: parsed.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
    date: parsed.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
  };
}

function StatusBadge({ status, time }: { status?: string; time: string }) {
  switch (status) {
    case 'live':
      return <span style={{ background: '#18C964', color: '#000', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>LIVE</span>;
    case 'finished':
      return <span style={{ background: '#374151', color: '#9CA3AF', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>FINISHED</span>;
    case 'postponed':
      return <span style={{ background: '#F59E0B', color: '#000', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>POSTPONED</span>;
    default:
      return time ? (
        <span style={{ background: 'rgba(24, 201, 100, 0.15)', color: '#18C964', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, border: '1px solid rgba(24, 201, 100, 0.3)' }}>{time}</span>
      ) : null;
  }
}

function ResultBadge({ result }: { result?: 'won' | 'lost' | 'pending' }) {
  if (!result || result === 'pending') return null;
  if (result === 'won') {
    return <span style={{ background: 'rgba(24, 201, 100, 0.15)', color: '#18C964', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, border: '1px solid rgba(24, 201, 100, 0.3)' }}>WON</span>;
  }
  return <span style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#EF4444', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, border: '1px solid rgba(239, 68, 68, 0.3)' }}>LOST</span>;
}

// Renders a competition logo when one is genuinely provided, otherwise a neutral
// placeholder. Never fabricates a logo or forwards an undefined `src` to Image.
function CompetitionLogo({ logo, name }: { logo?: string; name?: string }) {
  if (logo) {
    return <Image src={logo} alt={name ?? ''} width={20} height={20} style={{ borderRadius: 4, flexShrink: 0 }} />;
  }
  return (
    <span
      aria-hidden="true"
      style={{ width: 20, height: 20, borderRadius: 4, background: 'rgba(255,255,255,0.08)', display: 'inline-block', flexShrink: 0 }}
    />
  );
}

export function FixtureCard({ fixture, isEntitled }: FixtureCardProps) {
  const kickoff = formatDateTime(fixture.scheduledAt);
  const items = Array.isArray(fixture.items) ? fixture.items : [];
  const primaryMatch = typeof items[0]?.match === 'string' ? items[0].match.trim() : '';
  const title =
    (typeof fixture.title === 'string' && fixture.title.trim()) || primaryMatch || 'Matchday fixture';
  const leagueName = typeof fixture.league?.name === 'string' ? fixture.league.name : '';

  const prediction = fixture.prediction;
  const hasPrediction =
    !!prediction && (typeof prediction.market === 'string' || typeof prediction.selection === 'string');
  const odds = typeof prediction?.odds === 'number' && Number.isFinite(prediction.odds) ? prediction.odds : null;

  return (
    <Link href={`/predictions/${fixture.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={{
        background: '#0B1C17',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 12,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        transition: 'border-color 0.2s ease, transform 0.15s ease',
      }} onMouseEnter={(e) => e.currentTarget.style.borderColor = 'rgba(24, 201, 100, 0.5)'} onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            <CompetitionLogo logo={fixture.league?.logo} name={leagueName} />
            <span style={{ fontSize: 12, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {leagueName || title}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <StatusBadge status={fixture.status} time={kickoff.time} />
            <ResultBadge result={fixture.result} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#FFFFFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {title}
          </span>
          {kickoff.date && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#6B7280', fontSize: 11 }}>
              <Calendar size={10} />
              {kickoff.date}
            </span>
          )}
        </div>

        {items.length > 0 && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.slice(0, 6).map((item, index) => {
              const itemDate = formatDateTime(item.matchDateTime).date;
              return (
                <div key={item.id ?? index} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 13, color: '#D1D5DB', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {typeof item.match === 'string' && item.match.trim() ? item.match.trim() : 'Match'}
                  </span>
                  {itemDate && <span style={{ fontSize: 11, color: '#6B7280', flexShrink: 0 }}>{itemDate}</span>}
                </div>
              );
            })}
          </div>
        )}

        {hasPrediction && isEntitled && prediction && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ background: 'rgba(24, 201, 100, 0.15)', color: '#18C964', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, border: '1px solid rgba(24, 201, 100, 0.3)' }}>
                  PREDICTION
                </span>
              </div>
              {(prediction.market || prediction.selection) && (
                <p style={{ fontSize: 14, fontWeight: 600, color: '#FFFFFF', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {prediction.market ?? ''}{prediction.market && prediction.selection ? ': ' : ''}{prediction.selection ?? ''}
                </p>
              )}
              <p style={{ fontSize: 12, color: '#9CA3AF', margin: '2px 0 0' }}>
                {odds !== null ? `Odds ${odds.toFixed(2)}` : ''}
                {odds !== null && typeof prediction.confidence === 'number' ? ` • Model score ${prediction.confidence}` : ''}
              </p>
            </div>
            <ChevronRight size={18} style={{ color: '#6B7280', flexShrink: 0 }} />
          </div>
        )}

        {!isEntitled && hasPrediction && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12, textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: '#9CA3AF', margin: '0 0 8px' }}>Subscribe to unlock this prediction</p>
            <Link href="/pricing" style={{ textDecoration: 'none' }}>
              <button style={{ background: '#22C55E', color: '#000', border: 'none', borderRadius: 999, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                View Plans
              </button>
            </Link>
          </div>
        )}

        {!hasPrediction && fixture.status === 'scheduled' && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12, textAlign: 'center', color: '#6B7280', fontSize: 13 }}>
            Prediction available closer to kickoff
          </div>
        )}
      </div>
    </Link>
  );
}

export default function MatchdayPreview() {
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEntitled, setIsEntitled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        const [fixturesRes, entitledRes] = await Promise.all([
          fetch('/api/public/fixtures', { credentials: 'same-origin' }),
          fetch('/api/me', { credentials: 'same-origin' }),
        ]);
        if (!cancelled) {
          if (fixturesRes.ok) {
            const data = await fixturesRes.json();
            setFixtures(Array.isArray(data?.fixtures) ? data.fixtures : []);
          } else {
            setError('Failed to load fixtures');
          }
          if (entitledRes.ok) {
            const data = await entitledRes.json();
            setIsEntitled(data?.authenticated === true);
          }
        }
      } catch {
        if (!cancelled) setError('Failed to load fixtures');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchData();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <section style={{ padding: '64px 0', background: '#07110F' }}>
        <div className="container">
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {[1, 2, 3].map((i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 20, background: '#0B1C17', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12 }}>
                <div style={{ height: 16, width: '40%', background: 'rgba(255,255,255,0.06)', borderRadius: 4, animation: 'pulse 1.5s ease-in-out infinite' }} />
                <div style={{ height: 50, width: '100%', background: 'rgba(255,255,255,0.06)', borderRadius: 4, animation: 'pulse 1.5s ease-in-out infinite' }} />
                <div style={{ height: 14, width: '60%', background: 'rgba(255,255,255,0.06)', borderRadius: 4, animation: 'pulse 1.5s ease-in-out infinite' }} />
                <div style={{ height: 14, width: '40%', background: 'rgba(255,255,255,0.06)', borderRadius: 4, animation: 'pulse 1.5s ease-in-out infinite' }} />
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (error || fixtures.length === 0) {
    return (
      <section style={{ padding: '64px 0', background: '#07110F' }}>
        <div className="container" style={{ textAlign: 'center', maxWidth: 560, margin: '0 auto' }}>
          <p style={{ fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.18em', fontSize: 12, color: '#18C964', fontWeight: 600, margin: '0 0 12px' }}>
            Matchday Preview
          </p>
          <h2 style={{ fontSize: 'clamp(26px, 4vw, 36px)', lineHeight: 1.1, fontWeight: 800, color: '#FFFFFF', margin: '0 0 12px' }}>
            {error ? 'Unable to load fixtures' : 'No fixtures scheduled'}
          </h2>
          <p style={{ fontSize: 15, color: 'var(--chalk-muted)', lineHeight: 1.6, margin: 0 }}>
            {error ? 'Please try again later.' : 'Check back closer to matchday for predictions.'}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section style={{ padding: '64px 0', background: '#07110F' }}>
      <div className="container">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <p style={{ fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.18em', fontSize: 12, color: '#18C964', fontWeight: 600, margin: '0 0 8px' }}>
              Matchday Preview
            </p>
            <h2 style={{ fontSize: 'clamp(26px, 4vw, 36px)', lineHeight: 1.1, fontWeight: 800, color: '#FFFFFF', margin: 0 }}>
              Today's Fixtures
            </h2>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {fixtures.map((fixture) => (
            <FixtureCard key={fixture.id} fixture={fixture} isEntitled={isEntitled} />
          ))}
        </div>
      </div>
    </section>
  );
}