'use client';

import { passwordStrength } from '@/lib/password-strength';

const COLORS = ['var(--card-red)', 'var(--card-red)', '#d68a3a', 'var(--floodlight)', 'var(--floodlight)'];

export default function PasswordStrengthMeter({ password }: { password: string }) {
  if (!password) return null;
  const { score, label } = passwordStrength(password);

  return (
    <div style={{ marginTop: -10, marginBottom: 18 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              height: 3,
              flex: 1,
              borderRadius: 2,
              background: i < score ? COLORS[score] : 'rgba(243,245,236,0.14)',
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: 12, color: 'var(--chalk-muted)' }}>{label}</span>
    </div>
  );
}
