import { useId } from 'react';
import { useTheme } from '@/contexts/ThemeContext';

/** Circular progress ring for a single percentage — the donut/radial-gauge
 * pattern used across most modern dashboard products for one headline rate,
 * instead of only ever showing a percentage as plain text. Pure SVG, no
 * chart library needed for a single ring. The unfilled track uses a
 * diagonal-hatch fill rather than a flat tint — the detail that reads as
 * "premium dashboard" rather than a generic progress bar. */
export function RadialGauge({
  pct,
  size = 96,
  strokeWidth = 10,
  color = '#1568A8',
  label,
  sub,
  /** Value + label centered under the ring instead of beside it — for
   * laying several gauges out side by side rather than stacked. */
  centered = false,
}: {
  pct: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  label?: string;
  sub?: string;
  centered?: boolean;
}) {
  const { theme } = useTheme();
  const hatchColor = theme === 'dark' ? '#34455f' : '#cbd5e1';
  const clamped = Math.max(0, Math.min(100, pct));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  const center = size / 2;
  const patternId = `gauge-hatch-${useId()}`;
  // The label's font size was a fixed text-lg (18px), fine at this
  // component's original ~76-96px sizes but overflowing badly once
  // something like a compact card-header ring asks for a much smaller
  // size — scale it, and drop the decimal below a size where "100.0%"
  // physically can't fit.
  const fontSize = Math.max(9, Math.round(size / 4.2));
  const displayValue = size < 56 ? `${Math.round(clamped)}%` : `${clamped.toFixed(1)}%`;

  const ring = (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <pattern id={patternId} width="4" height="4" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="4" stroke={hatchColor} strokeWidth="1.5" />
          </pattern>
        </defs>
        <circle cx={center} cy={center} r={radius} fill="none" stroke={`url(#${patternId})`} strokeWidth={strokeWidth} />
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
        <span className="font-mono font-semibold tabular-nums text-text" style={{ fontSize }}>
          {displayValue}
        </span>
      </div>
    </div>
  );

  if (centered) {
    return (
      <div className="flex flex-col items-center text-center">
        {ring}
        {(label || sub) && (
          <div className="mt-2">
            {label && <div className="text-[12.5px] font-semibold text-text">{label}</div>}
            {sub && <div className="text-[11px] text-text-3">{sub}</div>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      {ring}
      {(label || sub) && (
        <div>
          {label && <div className="text-[13px] font-semibold text-text">{label}</div>}
          {sub && <div className="mt-0.5 text-[12px] text-text-3">{sub}</div>}
        </div>
      )}
    </div>
  );
}
