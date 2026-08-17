/** Circular progress ring for a single percentage — the donut/radial-gauge
 * pattern used across most modern dashboard products for one headline rate,
 * instead of only ever showing a percentage as plain text. Pure SVG, no
 * chart library needed for a single ring. */
export function RadialGauge({
  pct,
  size = 96,
  strokeWidth = 10,
  color = '#1568A8',
  label,
  sub,
}: {
  pct: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  label?: string;
  sub?: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  const center = size / 2;

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={center} cy={center} r={radius} fill="none" stroke="#f1f5f9" strokeWidth={strokeWidth} />
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.6s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-lg font-semibold tabular-nums text-text">{clamped.toFixed(1)}%</span>
        </div>
      </div>
      {(label || sub) && (
        <div>
          {label && <div className="text-[13px] font-semibold text-text">{label}</div>}
          {sub && <div className="mt-0.5 text-[12px] text-text-3">{sub}</div>}
        </div>
      )}
    </div>
  );
}
