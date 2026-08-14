type Plan = {
  id: string;
  name: string;
  durationDays: number;
  priceNGN: unknown; // Prisma Decimal, formatted below
  priceUSDOverride: unknown;
  accessScope: string;
};

function formatNaira(value: unknown): string {
  const n = Number(value);
  return `₦${n.toLocaleString('en-NG')}`;
}

export default function TicketCard({ plan, featured = false }: { plan: Plan; featured?: boolean }) {
  const usdOverride = plan.priceUSDOverride ? Number(plan.priceUSDOverride) : null;

  return (
    <div className="ticket" style={featured ? { outline: '2px solid var(--floodlight)' } : undefined}>
      <div className="ticket-torn" />
      <div className="ticket-body">
        <div className="eyebrow">{plan.durationDays}-DAY PASS</div>
        <div className="ticket-name">{plan.name}</div>

        <div className="ticket-price">
          {formatNaira(plan.priceNGN)}
          <span> / {plan.durationDays} days</span>
        </div>
        {usdOverride && (
          <div style={{ fontSize: 13, color: 'var(--chalk-muted)', marginTop: 4 }} className="mono">
            ${usdOverride.toFixed(2)} for accounts outside Nigeria
          </div>
        )}
        {!usdOverride && (
          <div style={{ fontSize: 13, color: 'var(--chalk-muted)', marginTop: 4 }}>
            USD price calculated automatically at checkout outside Nigeria
          </div>
        )}

        <div className="ticket-perforation" />

        <ul className="ticket-includes">
          <li>{plan.accessScope === 'all' ? 'Every published tip' : 'Selected leagues for this plan'}</li>
          <li>Booking code with every post</li>
          <li>Auto-renews — cancel anytime, keep access until the pass ends</li>
        </ul>

        <a href={`/register?plan=${plan.id}`} className="btn btn-primary" style={{ width: '100%' }}>
          Get this plan
        </a>

        <div className="ticket-barcode" aria-hidden="true" />
      </div>
    </div>
  );
}
