'use client';

import { useEffect, useState } from 'react';

type FixtureItem = {
  id: string;
  match: string;
  prediction: string;
  matchDateTime: string | null;
};

type Fixture = {
  id: string;
  title: string;
  scheduledAt: string;
  status: string;
  matchCount: number;
  items: FixtureItem[];
};

type FixtureCardProps = {
  fixture: Fixture;
};

export default function FixtureCard({ fixture }: FixtureCardProps) {
  const [isEntitled, setIsEntitled] = useState<boolean | null>(null);
  const item = fixture.items?.[0];
  const [homeTeam, awayTeam] = fixture.title?.split(' vs ') ?? ['', ''];

  const kickoff = item?.matchDateTime ? new Date(item.matchDateTime) : new Date(fixture.scheduledAt);
  const isValidDate = !isNaN(kickoff.getTime());

  useEffect(() => {
    let cancelled = false;
    fetch('/api/me', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setIsEntitled(!!data);
      })
      .catch(() => setIsEntitled(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const dateStr = isValidDate ? kickoff.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '—';
  const timeStr = isValidDate ? kickoff.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '—';

  const statusMap: Record<string, { label: string; color: string }> = {
    published: { label: 'Live', color: '#18C964' },
    scheduled: { label: 'Upcoming', color: 'var(--chalk-muted)' },
    archived: { label: 'Completed', color: '#A7B2AC' },
  };
  const status = statusMap[fixture.status] ?? { label: fixture.status, color: 'var(--chalk-muted)' };

  return (
    <article
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        padding: 20,
        background: '#0B1C17',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            color: '#18C964',
          }}
        >
          {fixture.title}
        </span>
        <h3
          style={{
            fontSize: 19,
            fontWeight: 700,
            color: '#FFFFFF',
            margin: 0,
            letterSpacing: '-0.01em',
          }}
        >
          {homeTeam && awayTeam ? `${homeTeam} vs ${awayTeam}` : fixture.title}
        </h3>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--chalk-muted)', fontFamily: 'var(--font-mono)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{dateStr}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{timeStr}</span>
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            padding: '3px 10px',
            borderRadius: 20,
            background: `${status.color}15`,
            color: status.color,
            border: `1px solid ${status.color}40`,
          }}
        >
          {status.label}
        </span>
      </div>

      {isEntitled === true && item ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.04)' }}>
          <span style={{ fontSize: 13, color: 'var(--chalk-muted)', fontFamily: 'var(--font-mono)' }}>Prediction:</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#18C964', fontFamily: 'var(--font-mono)' }}>{item.prediction}</span>
        </div>
      ) : isEntitled === true && !item ? (
        <p style={{ fontSize: 13, color: 'var(--chalk-muted)', margin: 0, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.04)' }}>
          Prediction details available to subscribers.
        </p>
      ) : null}
    </article>
  );
}
