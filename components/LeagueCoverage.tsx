import Link from 'next/link';

export default function LeagueCoverage() {
  const leagues = [
    'Premier League',
    'UEFA Champions League',
    'La Liga',
    'Serie A',
    'Bundesliga',
  ];

  return (
    <section style={{ padding: '64px 0', background: '#07110F' }}>
      <div className="container">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', textAlign: 'center', marginBottom: 40 }}>
          <p style={{ fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.18em', fontSize: 12, color: '#18C964', fontWeight: 600, margin: 0 }}>
            League Coverage
          </p>
          <h2 style={{ fontSize: 'clamp(26px, 4vw, 36px)', lineHeight: 1.1, fontWeight: 800, color: '#FFFFFF', margin: 0 }}>
            Football coverage that matters.
          </h2>
          <p style={{ fontSize: 15, color: 'var(--chalk-muted)', lineHeight: 1.6, margin: '12px 0 0', maxWidth: 560 }}>
            Predictions covering the competitions that drive the global matchday conversation.
            Coverage available depends on your subscription plan.
          </p>
        </div>

        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          {leagues.map((league) => (
            <Link
              key={league}
              href="/football-predictions"
              style={{
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
                background: '#0B1C17',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12,
                transition: 'border-color 0.2s ease, transform 0.15s ease',
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 600, color: '#FFFFFF', letterSpacing: '-0.01em' }}>
                {league}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
