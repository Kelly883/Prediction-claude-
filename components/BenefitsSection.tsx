import { ShieldCheck, RefreshCw, Lock, Users } from 'lucide-react';

const BENEFITS = [
  {
    icon: ShieldCheck,
    title: 'Transparent results',
    body: 'Every completed prediction is marked won or lost in our public archive. No cherry-picking, no hidden outcomes.',
  },
  {
    icon: RefreshCw,
    title: 'Matchday predictions',
    body: 'Research-backed football predictions with complete booking codes, delivered before every matchday.',
  },
  {
    icon: Lock,
    title: 'Secure payments',
    body: 'Pay via Paystack or Flutterwave. Every transaction is verified before your subscription is activated.',
  },
  {
    icon: Users,
    title: 'Flexible subscriptions',
    body: 'Choose a plan in NGN or USD that matches the leagues you want. Cancel auto-renewal anytime.',
  },
];

export default function BenefitsSection() {
  return (
    <section style={{ padding: '64px 0', background: '#0B1C17' }}>
      <div className="container">
        <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {BENEFITS.map((benefit, i) => {
            const Icon = benefit.icon;
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  gap: 14,
                  padding: 24,
                  background: '#07110F',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 12,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 40,
                    height: 40,
                    background: 'rgba(24, 201, 100, 0.10)',
                    border: '1px solid rgba(24, 201, 100, 0.20)',
                    borderRadius: 10,
                    color: '#18C964',
                    flexShrink: 0,
                  }}
                >
                  <Icon size={18} strokeWidth={2} />
                </div>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: '#FFFFFF', margin: '0 0 8px', letterSpacing: '-0.01em' }}>
                    {benefit.title}
                  </h3>
                  <p style={{ fontSize: 14, color: 'var(--chalk-muted)', lineHeight: 1.6, margin: 0 }}>
                    {benefit.body}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
