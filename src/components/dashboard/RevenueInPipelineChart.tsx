import { useMemo, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '@/hooks/useChartTheme';

export interface RevenuePipelinePoint {
  iso: string;
  label: string;
  expected: number;
  actual: number;
}

const EXPECTED_COLOR = '#7D8597';
const ACTUAL_COLOR = '#6E7BFF';

const RANGE_OPTIONS = [
  { key: '3m', label: '3M', months: 3 },
  { key: '6m', label: '6M', months: 6 },
  { key: 'ytd', label: 'YTD', months: null },
] as const;
type RangeKey = (typeof RANGE_OPTIONS)[number]['key'];

function formatShort(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(v % 1_000 === 0 ? 0 : 1)}k`;
  return `$${v}`;
}

const money = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** Two series sharing one timeline: Expected is the assignment fee sitting
 * across every lead currently Under Contract, In Title, or Closed —
 * reconstructed day by day from each lead's real stage-change history (see
 * DashboardPage's revenueInPipelineTrend) rather than just today's snapshot.
 * Actual is the narrower, realized slice of that same money — only the fee
 * for leads that have actually landed in Closed — so a viewer can see both
 * the full pipeline and how much of it has genuinely turned into paid
 * revenue at a glance, not just today's totals.
 *
 * Drawn as a smooth curve (monotone) rather than the literal step function
 * the underlying data actually is — a deliberate readability choice (matches
 * the Tristate Ledger mockup's own style) over literal accuracy of shape;
 * the real values themselves are never altered, only how the line between
 * two real points is drawn. */
export function RevenueInPipelineChart({ data }: { data: RevenuePipelinePoint[] }) {
  const ct = useChartTheme();
  const [range, setRange] = useState<RangeKey>('6m');

  const visible = useMemo(() => {
    const opt = RANGE_OPTIONS.find((r) => r.key === range)!;
    if (opt.months != null) return data.slice(-opt.months);
    const jan1 = new Date(new Date().getFullYear(), 0, 1);
    const fromIdx = data.findIndex((d) => new Date(d.iso) >= jan1);
    return fromIdx === -1 ? data : data.slice(fromIdx);
  }, [data, range]);

  const totalActual = visible.reduce((s, d) => s + d.actual, 0);
  const totalExpected = visible.reduce((s, d) => s + d.expected, 0);
  const sinceLabel = visible.length ? visible[0].label : '';
  // A sparse account (few/no leads reaching Contract+ in this window) makes
  // both series genuine flat lines — Recharts' default auto-domain then
  // scales to that one value with zero headroom, so a flat "expected" pins
  // visually to the chart's ceiling and a flat $0 "actual" pins to its
  // floor, reading as broken rather than as "accurately nothing's moved
  // yet." A fixed minimum ceiling plus real padding above the max fixes the
  // pinned-to-the-top case; a muted/dashed treatment for an all-zero series
  // fixes the "looks like missing data" case.
  const actualIsFlatZero = visible.every((d) => d.actual === 0);

  return (
    <div className="flex h-full min-h-[220px] flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[26px] font-bold leading-none tracking-tight text-text">{money(totalActual)}</span>
            <span className="text-[13px] text-text-3">
              of <span className="font-mono">{money(totalExpected)}</span> planned since {sinceLabel}
            </span>
          </div>
          <div className="mt-2.5 flex items-center gap-4 text-[13px]">
            <span className="flex items-center gap-1.5 text-text-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ACTUAL_COLOR }} /> Actual
            </span>
            <span className="flex items-center gap-1.5 text-text-2">
              <span className="h-0 w-3.5 shrink-0 border-t-2 border-dashed" style={{ borderColor: EXPECTED_COLOR }} /> Expected
            </span>
          </div>
        </div>
        <div role="group" aria-label="Range" className="flex shrink-0 gap-1 rounded-lg border border-border-2 bg-surface-3 p-0.5">
          {RANGE_OPTIONS.map((r) => (
            <button
              key={r.key}
              type="button"
              aria-pressed={range === r.key}
              onClick={() => setRange(r.key)}
              className={`rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors ${
                range === r.key ? 'bg-surface text-text shadow-sm' : 'text-text-3 hover:text-text-2'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={visible} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gRevenueActual" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={ACTUAL_COLOR} stopOpacity={0.32} />
                <stop offset="100%" stopColor={ACTUAL_COLOR} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={ct.gridStroke} vertical={false} />
            <XAxis dataKey="label" stroke={ct.axisStroke} fontSize={10} tickLine={false} axisLine={false} />
            <YAxis
              stroke={ct.axisStroke}
              fontSize={10}
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={formatShort}
              domain={[0, (dataMax: number) => Math.max(dataMax * 1.25, 1000)]}
            />
            <Tooltip
              cursor={{ stroke: ct.axisStroke, strokeWidth: 1, strokeDasharray: '4 4' }}
              contentStyle={{
                background: ct.tooltipBg,
                border: `1px solid ${ct.tooltipBorder}`,
                borderRadius: 10,
                fontSize: 12,
                boxShadow: '0 10px 25px -8px rgba(11,30,51,0.25)',
                padding: '8px 12px',
                color: ct.textFill,
              }}
              itemStyle={{ padding: '1px 0' }}
              formatter={(value: number, name: string) => [money(value), name]}
            />
            <Area
              type="monotone"
              dataKey="actual"
              name="Actual (Closed)"
              stroke={ACTUAL_COLOR}
              strokeOpacity={actualIsFlatZero ? 0.35 : 1}
              strokeDasharray={actualIsFlatZero ? '4 4' : undefined}
              fill={actualIsFlatZero ? 'none' : 'url(#gRevenueActual)'}
              strokeWidth={2.5}
              dot={false}
              activeDot={actualIsFlatZero ? false : { r: 5, strokeWidth: 2, stroke: ct.tooltipBg }}
              animationDuration={500}
            />
            <Line
              type="monotone"
              dataKey="expected"
              name="Expected"
              stroke={EXPECTED_COLOR}
              strokeWidth={2}
              strokeDasharray="6 5"
              dot={false}
              activeDot={{ r: 5, strokeWidth: 2, stroke: ct.tooltipBg }}
              animationDuration={500}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
