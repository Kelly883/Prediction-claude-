'use client';

import { useId } from 'react';

const spinnerStyles = `
.pps-root {
  position: fixed;
  inset: 0;
  z-index: 9999;
  min-height: 100vh;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 24px;
  overflow: hidden;
  background: #000000;
}
.pps-stage {
  position: relative;
  width: 220px;
  height: 220px;
  flex: none;
}
.pps-ring {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.pps-ring-spin {
  transform-box: view-box;
  transform-origin: 150px 150px;
  animation: pps-spin 3s linear infinite;
  will-change: transform;
  backface-visibility: hidden;
}
.pps-mark-wrap {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 110px;
  height: 110px;
  transform: translate(-50%, -50%);
  z-index: 2;
}
.pps-mark {
  width: 100%;
  height: 100%;
  overflow: visible;
}
.pps-heartbeat {
  transform-box: view-box;
  transform-origin: 60px 57px;
  animation: pps-heartbeat 1.2s ease-in-out infinite;
  will-change: transform;
  backface-visibility: hidden;
}
.pps-label {
  color: #EAB308;
  font-family: 'Space Grotesk', Arial, Helvetica, sans-serif;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.36em;
  line-height: 1;
  text-transform: uppercase;
}
@keyframes pps-spin {
  to { transform: rotate(360deg); }
}
@keyframes pps-heartbeat {
  0% { transform: scale(1); }
  14% { transform: scale(1.12); }
  28% { transform: scale(1); }
  42% { transform: scale(1.08); }
  70% { transform: scale(1); }
  100% { transform: scale(1); }
}
@media (min-width: 768px) {
  .pps-stage { width: 280px; height: 280px; }
}
@media (prefers-reduced-motion: reduce) {
  .pps-ring-spin,
  .pps-heartbeat { animation: none; }
}
`;

type PredictProSpinnerProps = {
  label?: string;
};

export default function PredictProSpinner({ label = 'Loading' }: PredictProSpinnerProps) {
  const rawId = useId();
  const id = rawId.replace(/:/g, '');
  const goldId = `pps-gold-${id}`;

  return (
    <div className="pps-root" role="status" aria-live="polite">
      <style>{spinnerStyles}</style>
      <div className="pps-stage">
        <svg className="pps-ring" viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <path
              id="circlePath"
              d="M 150,150 m -110,0 a 110,110 0 1,1 220,0 a 110,110 0 1,1 -220,0"
            />
          </defs>
          <g className="pps-ring-spin">
            <text
              fill="#EAB308"
              fontFamily="Arial, Helvetica, sans-serif"
              fontSize="20px"
              fontWeight={900}
              letterSpacing="3px"
              textAnchor="middle"
            >
              <textPath
                href="#circlePath"
                startOffset="50%"
                textLength={690}
                lengthAdjust="spacingAndGlyphs"
              >
                PREDICTPRO • PREDICTPRO • PREDICTPRO • PREDICTPRO •{' '}
              </textPath>
            </text>
          </g>
        </svg>

        <div className="pps-mark-wrap">
          <svg className="pps-mark" viewBox="0 0 120 114" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs>
              <linearGradient id={goldId} x1="34" y1="8" x2="112" y2="92" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#EAB308" />
                <stop offset="100%" stopColor="#FACC15" />
              </linearGradient>
            </defs>
            <g className="pps-heartbeat" fontWeight={900}>
              <path
                d="M 34 6 H 76 C 102 6 116 22 116 46 C 116 72 98 88 70 88 H 50 L 44 106 H 20 Z"
                fill={`url(#${goldId})`}
              />
              <path
                d="M 22 6 H 52 L 32 106 H 6 Z"
                fill="#FFFFFF"
              />
              <ellipse cx="79" cy="47" rx="25" ry="24" fill="#000000" />
              <g transform="translate(79 47)">
                <circle cx="0" cy="0" r="19" fill="#FFFFFF" stroke="#111111" strokeWidth="2.5" />
                <polygon points="0,-7 6.6,-2.2 4.1,5.7 -4.1,5.7 -6.6,-2.2" fill="#111111" />
                <line x1="0" y1="-7" x2="0" y2="-18" stroke="#111111" strokeWidth="1.8" />
                <line x1="6.6" y1="-2.2" x2="16.8" y2="-5.5" stroke="#111111" strokeWidth="1.8" />
                <line x1="4.1" y1="5.7" x2="11.5" y2="14.5" stroke="#111111" strokeWidth="1.8" />
                <line x1="-4.1" y1="5.7" x2="-11.5" y2="14.5" stroke="#111111" strokeWidth="1.8" />
                <line x1="-6.6" y1="-2.2" x2="-16.8" y2="-5.5" stroke="#111111" strokeWidth="1.8" />
                <polygon points="0,-18 -6,-15.5 -9,-17.5" fill="#111111" />
                <polygon points="16.8,-5.5 18,-11.5 15,-14.5" fill="#111111" />
                <polygon points="11.5,14.5 17,11.5 18,7" fill="#111111" />
                <polygon points="-11.5,14.5 -17,11.5 -18,7" fill="#111111" />
                <polygon points="-16.8,-5.5 -18,-11.5 -15,-14.5" fill="#111111" />
              </g>
            </g>
          </svg>
        </div>
      </div>
      <div className="pps-label">{label}</div>
    </div>
  );
}
