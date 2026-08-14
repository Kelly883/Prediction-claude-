import React from 'react';

type LogoProps = {
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
  adminBadge?: boolean;
};

export default function Logo({ size = 'md', showTagline = false, adminBadge = false }: LogoProps) {
  const iconHeight = size === 'sm' ? 28 : size === 'lg' ? 44 : 34;
  const iconWidth = Math.round(iconHeight * 1.05);
  const titleFontSize = size === 'sm' ? 18 : size === 'lg' ? 26 : 21;
  const taglineFontSize = size === 'sm' ? 8 : size === 'lg' ? 10 : 9;

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: size === 'sm' ? 8 : 10,
        textDecoration: 'none',
        userSelect: 'none',
      }}
    >
      {/* Precision Vector Emblem: Stylized Dynamic 'P' + Shooting Football */}
      <svg
        width={iconWidth}
        height={iconHeight}
        viewBox="0 0 120 114"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ flexShrink: 0, overflow: 'visible' }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="pGoldGrad" x1="40" y1="20" x2="115" y2="95" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#F5B335" />
            <stop offset="100%" stopColor="#E28912" />
          </linearGradient>
          <linearGradient id="pSpeedGrad" x1="0" y1="90" x2="60" y2="40" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#F5B335" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#F5B335" />
          </linearGradient>
          <filter id="pShadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#000" floodOpacity="0.3" />
          </filter>
        </defs>

        {/* Dynamic Speed Streaks trailing from bottom-left */}
        <polygon points="12,106 38,72 44,72 20,106" fill="url(#pSpeedGrad)" />
        <polygon points="24,106 52,68 58,68 32,106" fill="url(#pGoldGrad)" />
        <polygon points="36,106 66,66 72,66 44,106" fill="url(#pGoldGrad)" />

        {/* Amber / Gold curve right section */}
        <path
          d="M 52 14
             L 86 14
             C 108 14 116 28 116 46
             C 116 68 100 82 72 82
             L 50 82
             L 40 98
             L 68 98
             C 104 98 124 78 124 46
             C 124 18 102 2 76 2
             L 34 2
             Z"
          fill="url(#pGoldGrad)"
        />

        {/* Crisp White Primary P Body with forward slant */}
        <path
          d="M 32 2
             L 76 2
             C 98 2 110 14 110 32
             C 100 24 88 20 74 20
             L 52 20
             L 28 88
             L 12 88
             L 26 2
             Z"
          fill="#FFFFFF"
        />

        {/* Football / Soccer Ball with Speed Motion */}
        <g transform="translate(68, 42)" filter="url(#pShadow)">
          {/* Ball Base */}
          <circle cx="0" cy="0" r="22" fill="#FFFFFF" stroke="#121814" strokeWidth="2.5" />

          {/* Central Black Pentagon */}
          <polygon
            points="0,-8 7.6,-2.5 4.7,6.5 -4.7,6.5 -7.6,-2.5"
            fill="#121814"
          />

          {/* Outer Pattern Lines & Surrounding Black Patches */}
          <line x1="0" y1="-8" x2="0" y2="-21" stroke="#121814" strokeWidth="2" />
          <line x1="7.6" y1="-2.5" x2="19.5" y2="-6.5" stroke="#121814" strokeWidth="2" />
          <line x1="4.7" y1="6.5" x2="13.5" y2="16.5" stroke="#121814" strokeWidth="2" />
          <line x1="-4.7" y1="6.5" x2="-13.5" y2="16.5" stroke="#121814" strokeWidth="2" />
          <line x1="-7.6" y1="-2.5" x2="-19.5" y2="-6.5" stroke="#121814" strokeWidth="2" />

          {/* Edge Pentagons / Triangles */}
          <polygon points="0,-21 -8,-18 -12,-20" fill="#121814" />
          <polygon points="19.5,-6.5 21,-14 15,-18" fill="#121814" />
          <polygon points="13.5,16.5 20.5,10 21.5,5" fill="#121814" />
          <polygon points="-13.5,16.5 -20.5,10 -21.5,5" fill="#121814" />
          <polygon points="-19.5,-6.5 -21,-14 -15,-18" fill="#121814" />
        </g>
      </svg>

      {/* Wordmark Typography */}
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
          <span
            style={{
              fontFamily: "'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              fontWeight: 900,
              fontSize: titleFontSize,
              letterSpacing: '0.04em',
              color: '#FFFFFF',
              fontStyle: 'italic',
              textTransform: 'uppercase',
            }}
          >
            PREDICT
          </span>
          <span
            style={{
              fontFamily: "'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              fontWeight: 900,
              fontSize: titleFontSize,
              letterSpacing: '0.04em',
              color: '#F5B335',
              fontStyle: 'italic',
              textTransform: 'uppercase',
            }}
          >
            PRO
          </span>
          {adminBadge && (
            <span
              style={{
                marginLeft: 6,
                padding: '2px 6px',
                background: 'rgba(245, 179, 53, 0.16)',
                border: '1px solid rgba(245, 179, 53, 0.4)',
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
                color: '#F5B335',
                letterSpacing: '0.08em',
                fontStyle: 'normal',
              }}
            >
              ADMIN
            </span>
          )}
        </div>

        {showTagline && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 3,
            }}
          >
            <span style={{ width: 14, height: 1, background: '#F5B335', opacity: 0.7 }} />
            <span
              style={{
                fontSize: taglineFontSize,
                fontWeight: 700,
                letterSpacing: '0.22em',
                color: '#76B880',
                textTransform: 'uppercase',
                fontFamily: "'Space Grotesk', sans-serif",
              }}
            >
              MATCHDAY, EVERY DAY
            </span>
            <span style={{ width: 14, height: 1, background: '#F5B335', opacity: 0.7 }} />
          </div>
        )}
      </div>
    </div>
  );
}
