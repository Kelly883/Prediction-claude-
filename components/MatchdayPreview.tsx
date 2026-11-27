'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Calendar, ChevronRight, Trophy } from 'lucide-react';

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
  league?: string | null;
  homeTeam?: string | null;
  awayTeam?: string | null;
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

function formatDateTime(value?: string): { time: string; date: string; isoDate: string } {
  if (!value) return { time: '', date: '', isoDate: '' };
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { time: '', date: '', isoDate: '' };
  return {
    time: parsed.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
    date: parsed.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
    isoDate: parsed.toISOString().split('T')[0],
  };
}

function StatusBadge({ status, time }: { status?: string; time: string }) {
  switch (status) {
    case 'live':
      return (
        <span style={{
          background: '#18C964',
          color: '#000',
          padding: '2px 8px',
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 700,
          fontFamily: 'var(--font-mono), monospace',
        }}>
          LIVE
        </span>
      );
    case 'finished':
      return (
        <span style={{
          background: '#374151',
          color: '#9CA3AF',
          padding: '2px 8px',
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 700,
          fontFamily: 'var(--font-mono), monospace',
        }}>
          FT
        </span>
      );
    case 'postponed':
      return (
        <span style={{
          background: '#F59E0B',
          color: '#000',
          padding: '2px 8px',
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 700,
          fontFamily: 'var(--font-mono), monospace',
        }}>
          POSTPONED
        </span>
      );
    default:
      return time ? (
        <span style={{
          background: 'rgba(24, 201, 100, 0.12)',
          color: '#18C964',
          padding: '3px 10px',
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 600,
          fontFamily: 'var(--font-mono), monospace',
          border: '1px solid rgba(24, 201, 100, 0.25)',
        }}>
          {time}
        </span>
      ) : (
        <span style={{
          background: 'rgba(255,255,255,0.06)',
          color: '#6B7280',
          padding: '3px 10px',
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 500,
          fontFamily: 'var(--font-mono), monospace',
        }}>
          Time TBC
        </span>
      );
  }
}

function ResultBadge({ result }: { result?: 'won' | 'lost' | 'pending' }) {
  if (!result || result === 'pending') return null;
  if (result === 'won') {
    return (
      <span style={{
        background: 'rgba(24, 201, 100, 0.12)',
        color: '#18C964',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        fontFamily: 'var(--font-mono), monospace',
        border: '1px solid rgba(24, 201, 100, 0.25)',
      }}>
        WON
      </span>
    );
  }
  return (
    <span style={{
      background: 'rgba(239, 68, 68, 0.12)',
      color: '#EF4444',
      padding: '2px 8px',
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 700,
      fontFamily: 'var(--font-mono), monospace',
      border: '1px solid rgba(239, 68, 68, 0.25)',
    }}>
      LOST
    </span>
  );
}

function TeamLogo({ logo, name, fallbackInitials }: { logo?: string; name?: string; fallbackInitials: string }) {
  if (logo) {
    return (
      <Image
        src={logo}
        alt={name ?? ''}
        width={40}
        height={40}
        style={{ borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }}
      />
    );
  }
  return (
    <div style={{
      width: 40,
      height: 40,
      borderRadius: '50%',
      background: 'linear-gradient(135deg, rgba(24, 201, 100, 0.25), rgba(10, 33, 22, 0.9))',
      border: '1px solid rgba(24, 201, 100, 0.3)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      fontSize: 13,
      fontWeight: 700,
      color: '#18C964',
      fontFamily: 'var(--font-display), sans-serif',
      letterSpacing: '0.02em',
    }}>
      {fallbackInitials}
    </div>
  );
}

function getTeamInitials(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function CompetitionLogo({ logo, name }: { logo?: string; name?: string }) {
  if (logo) {
    return <Image src={logo} alt={name ?? ''} width={24} height={24} style={{ borderRadius: 4, flexShrink: 0 }} />;
  }
  return (
    <div style={{
      width: 24,
      height: 24,
      borderRadius: 4,
      background: 'rgba(24, 201, 100, 0.15)',
      border: '1px solid rgba(24, 201, 100, 0.25)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    }}>
      <Trophy size={12} style={{ color: '#18C964' }} />
    </div>
  );
}

function parseMatchString(match: string): { home: string; away: string } | null {
  const separators = [' vs ', ' VS ', ' - ', ' – '];
  for (const sep of separators) {
    const idx = match.indexOf(sep);
    if (idx > 0) {
      return { home: match.slice(0, idx).trim(), away: match.slice(idx + sep.length).trim() };
    }
  }
  return null;
}

function MatchRow({ fixture, isEntitled }: FixtureCardProps) {
  const kickoff = formatDateTime(fixture.scheduledAt);
  const items = Array.isArray(fixture.items) ? fixture.items : [];
  const primaryMatch = typeof items[0]?.match === 'string' ? items[0].match.trim() : '';
  const title = (typeof fixture.title === 'string' && fixture.title.trim()) || primaryMatch || 'Matchday fixture';
  const leagueName = typeof fixture.league === 'string' && fixture.league ? fixture.league : '';

  const prediction = fixture.prediction;
  const hasPrediction = !!prediction && (typeof prediction.market === 'string' || typeof prediction.selection === 'string');
  const odds = typeof prediction?.odds === 'number' && Number.isFinite(prediction.odds) ? prediction.odds : null;

  const parsedMatch = parseMatchString(title);
  const homeTeamName = typeof fixture.homeTeam === 'string' && fixture.homeTeam ? fixture.homeTeam : (parsedMatch?.home || '');
  const awayTeamName = typeof fixture.awayTeam === 'string' && fixture.awayTeam ? fixture.awayTeam : (parsedMatch?.away || '');
  const homeTeamLogo: string | undefined = undefined;
  const awayTeamLogo: string | undefined = undefined;
  const homeInitials = getTeamInitials(homeTeamName);
  const awayInitials = getTeamInitials(awayTeamName);

  return (
    <Link href={`/predictions/${fixture.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <div style={{
        background: '#0B1C17',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 12,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        transition: 'border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease',
      }} onMouseEnter={(e) => {
        const target = e.currentTarget as HTMLElement;
        target.style.borderColor = 'rgba(24, 201, 100, 0.4)';
        target.style.background = 'rgba(24, 201, 100, 0.03)';
        target.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.25)';
      }} onMouseLeave={(e) => {
        const target = e.currentTarget as HTMLElement;
        target.style.borderColor = 'rgba(255,255,255,0.06)';
        target.style.background = '#0B1C17';
        target.style.boxShadow = 'none';
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            <CompetitionLogo logo={undefined} name={leagueName} />
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              color: '#9CA3AF',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              fontFamily: 'var(--font-mono), monospace',
            }}>
              {leagueName || 'Matchday'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <StatusBadge status={fixture.status} time={kickoff.time} />
            <ResultBadge result={fixture.result} />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 0' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flex: 1, minWidth: 0, gap: 2 }}>
            <TeamLogo logo={homeTeamLogo} name={homeTeamName} fallbackInitials={homeInitials} />
            <span style={{
              fontSize: 14,
              fontWeight: 600,
              color: '#FFFFFF',
              textAlign: 'right',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '100%',
            }}>
              {homeTeamName || 'Home Team'}
            </span>
          </div>

          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            padding: '0 8px',
            minWidth: 44,
          }}>
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#18C964',
              fontFamily: 'var(--font-mono), monospace',
              letterSpacing: '0.05em',
              background: 'rgba(24, 201, 100, 0.12)',
              padding: '2px 8px',
              borderRadius: 999,
              border: '1px solid rgba(24, 201, 100, 0.25)',
            }}>
              VS
            </span>
            {kickoff.time && (
              <time dateTime={fixture.scheduledAt} style={{
                marginTop: 6,
                fontSize: 11,
                color: '#6B7280',
                fontFamily: 'var(--font-mono), monospace',
                whiteSpace: 'nowrap',
              }}>
                {kickoff.time}
              </time>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', flex: 1, minWidth: 0, gap: 2 }}>
            <TeamLogo logo={awayTeamLogo} name={awayTeamName} fallbackInitials={awayInitials} />
            <span style={{
              fontSize: 14,
              fontWeight: 600,
              color: '#FFFFFF',
              textAlign: 'left',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '100%',
            }}>
              {awayTeamName || 'Away Team'}
            </span>
          </div>
        </div>

        {items.length > 1 && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {items.slice(1, 4).map((item, index) => {
              const itemDate = formatDateTime(item.matchDateTime);
              const parsed = parseMatchString(typeof item.match === 'string' ? item.match.trim() : '');
              return (
                <div key={item.id ?? `extra-${index}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
                  <span style={{ color: '#D1D5DB', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                    {parsed ? `${parsed.home} vs ${parsed.away}` : (typeof item.match === 'string' && item.match.trim() ? item.match.trim() : 'Match')}
                  </span>
                  {itemDate.time && <span style={{ fontSize: 10, color: '#6B7280', flexShrink: 0, fontFamily: 'var(--font-mono), monospace' }}>{itemDate.time}</span>}
                </div>
              );
            })}
            {items.length > 4 && (
              <span style={{ fontSize: 11, color: '#6B7280', textAlign: 'center', paddingTop: 4 }}>
                +{items.length - 4} more matches
              </span>
            )}
          </div>
        )}

        {hasPrediction && isEntitled && prediction && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{
                  background: 'rgba(24, 201, 100, 0.12)',
                  color: '#18C964',
                  padding: '2px 8px',
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono), monospace',
                  border: '1px solid rgba(24, 201, 100, 0.25)',
                  letterSpacing: '0.05em',
                }}>
                  PREDICTION
                </span>
              </div>
              {(prediction.market || prediction.selection) && (
                <p style={{ fontSize: 13, fontWeight: 600, color: '#FFFFFF', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {prediction.market ?? ''}{prediction.market && prediction.selection ? ': ' : ''}{prediction.selection ?? ''}
                </p>
              )}
              <p style={{ fontSize: 11, color: '#9CA3AF', margin: '2px 0 0' }}>
                {odds !== null ? `Odds ${odds.toFixed(2)}` : ''}
                {odds !== null && typeof prediction.confidence === 'number' ? ` • Score ${prediction.confidence}` : ''}
              </p>
            </div>
            <ChevronRight size={16} style={{ color: '#6B7280', flexShrink: 0 }} />
          </div>
        )}

        {!isEntitled && hasPrediction && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10, textAlign: 'center' }}>
            <p style={{ fontSize: 12, color: '#9CA3AF', margin: '0 0 8px' }}>Subscribe to unlock this prediction</p>
            <Link href="/pricing" style={{ textDecoration: 'none' }}>
              <button style={{ background: '#22C55E', color: '#000', border: 'none', borderRadius: 999, padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-display), sans-serif' }}>
                View Plans
              </button>
            </Link>
          </div>
        )}

        {!hasPrediction && fixture.status === 'scheduled' && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10, textAlign: 'center', color: '#6B7280', fontSize: 12 }}>
            Prediction available closer to kickoff
          </div>
        )}
      </div>
    </Link>
  );
}

export function FixtureCard({ fixture, isEntitled }: FixtureCardProps) {
  return <MatchRow fixture={fixture} isEntitled={isEntitled} />;
}

function groupFixturesByLeague(fixtures: Fixture[]): Map<string, Fixture[]> {
  const groups = new Map<string, Fixture[]>();
  for (const fixture of fixtures) {
    const leagueKey = typeof fixture.league === 'string' && fixture.league ? fixture.league : 'Other Matches';
    if (!groups.has(leagueKey)) groups.set(leagueKey, []);
    groups.get(leagueKey)!.push(fixture);
  }
  return groups;
}

function LeagueSection({ leagueName, fixtures, isEntitled }: { leagueName: string; fixtures: Fixture[]; isEntitled: boolean }) {
  const isOther = leagueName === 'Other Matches';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {!isOther && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 4px', marginBottom: 4 }}>
          <div style={{
            width: 32,
            height: 3,
            background: 'linear-gradient(90deg, #18C964, #F5B335)',
            borderRadius: 2,
            flexShrink: 0,
          }} />
          <span style={{
            fontSize: 13,
            fontWeight: 700,
            color: '#FFFFFF',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontFamily: 'var(--font-mono), monospace',
          }}>
            {leagueName}
          </span>
          <span style={{
            fontSize: 11,
            color: '#6B7280',
            fontFamily: 'var(--font-mono), monospace',
            background: 'rgba(255,255,255,0.06)',
            padding: '1px 8px',
            borderRadius: 999,
          }}>
            {fixtures.length} match{fixtures.length !== 1 ? 'es' : ''}
          </span>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {fixtures.map((fixture) => (
          <MatchRow key={fixture.id} fixture={fixture} isEntitled={isEntitled} />
        ))}
      </div>
    </div>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[1, 2, 3].map((i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', background: '#0B1C17', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                    <div style={{ width: 24, height: 24, borderRadius: 4, background: 'rgba(255,255,255,0.06)', animation: 'pulse 1.5s ease-in-out infinite' }} />
                    <div style={{ height: 14, width: '40%', background: 'rgba(255,255,255,0.06)', borderRadius: 4, animation: 'pulse 1.5s ease-in-out infinite' }} />
                  </div>
                  <div style={{ width: 80, height: 24, background: 'rgba(255,255,255,0.06)', borderRadius: 999, animation: 'pulse 1.5s ease-in-out infinite' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 0' }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', animation: 'pulse 1.5s ease-in-out infinite' }} />
                  <div style={{ width: 44, height: 24, background: 'rgba(255,255,255,0.06)', borderRadius: 999, animation: 'pulse 1.5s ease-in-out infinite' }} />
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', animation: 'pulse 1.5s ease-in-out infinite' }} />
                </div>
                <div style={{ height: 12, width: '60%', background: 'rgba(255,255,255,0.06)', borderRadius: 4, animation: 'pulse 1.5s ease-in-out infinite' }} />
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

  const today = new Date();
  const dateStr = today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const totalMatches = fixtures.reduce((sum, f) => sum + (f.matchCount ?? f.items?.length ?? 1), 0);
  const groupedFixtures = groupFixturesByLeague(fixtures);

  return (
    <section style={{ padding: '64px 0', background: '#07110F' }}>
      <div className="container">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <p style={{ fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.18em', fontSize: 12, color: '#18C964', fontWeight: 600, margin: '0 0 8px' }}>
              Matchday Preview
            </p>
            <h2 style={{ fontSize: 'clamp(26px, 4vw, 36px)', lineHeight: 1.1, fontWeight: 800, color: '#FFFFFF', margin: 0 }}>
              Today's Fixtures
            </h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <time dateTime={today.toISOString().split('T')[0]} style={{
              fontSize: 13,
              color: '#9CA3AF',
              fontFamily: 'var(--font-mono), monospace',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgba(255,255,255,0.04)',
              padding: '6px 12px',
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <Calendar size={13} style={{ color: '#6B7280' }} />
              {dateStr}
            </time>
            {totalMatches > 0 && (
              <span style={{
                fontSize: 12,
                fontWeight: 600,
                color: '#18C964',
                fontFamily: 'var(--font-mono), monospace',
                background: 'rgba(24, 201, 100, 0.12)',
                padding: '4px 12px',
                borderRadius: 999,
                border: '1px solid rgba(24, 201, 100, 0.25)',
              }}>
                {totalMatches} match{totalMatches !== 1 ? 'es' : ''} today
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {Array.from(groupedFixtures.entries()).map(([leagueName, leagueFixtures]) => (
            <LeagueSection key={leagueName} leagueName={leagueName} fixtures={leagueFixtures} isEntitled={isEntitled} />
          ))}
        </div>
      </div>
    </section>
  );
}