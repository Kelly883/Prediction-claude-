const items = [
  'BOOKING CODE INCLUDED ON EVERY TIP',
  'NEW TIPS BEFORE EVERY MATCHDAY',
  'EPL · LA LIGA · SERIE A · UCL COVERAGE',
  'NGN & USD PRICING, AUTO-CONVERTED',
];

export default function Ticker({ tipCount }: { tipCount: number }) {
  const withCount = [`${tipCount} TIPS PUBLISHED`, ...items];
  // Duplicated once so the CSS animation (translateX -50%) loops seamlessly.
  const doubled = [...withCount, ...withCount];

  return (
    <div className="ticker">
      <div className="ticker-track">
        {doubled.map((item, i) => (
          <span className="ticker-item" key={i}>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
