import { Area, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '@/hooks/useChartTheme';

export interface RevenuePipelinePoint {
  iso: string;
  label: string;
  expected: number;
  actual: number;
}

const EXPECTED_COLOR = '#C9A24B';
const ACTUAL_COLOR = '#10B981';

function formatShort(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(v % 1_000 === 0 ? 0 : 1)}k`;
  return `$${v}`;
}

const money = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function StatHead({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="text-[11px] text-text-3">{label}</span>
      <span className="font-mono text-[15px] font-bold text-text">{money(value)}</span>
    </div>
  );
}

/** Two series sharing one timeline: Expected (the gold line, unchanged from
 * before this had a second series) is the assignment fee sitting across
 * every lead currently Under Contract, In Title, or Closed — the same
 * three-phases-of-one-deal step function as always, reconstructed day by
 * day from each lead's real stage-change history (see DashboardPage's
 * revenueInPipelineTrend) rather than just today's snapshot. Actual is the
 * narrower, realized slice of that same money — only the fee for leads that
 * have actually landed in Closed, nothing still in Contract or In Title —
 * so a viewer can see both the full pipeline and how much of it has
 * genuinely turned into paid revenue at a glance, not just today's totals.
 *
 * Both rendered as step areas, not straight-line interpolation — the
 * underlying values only ever move when a lead actually enters or leaves a
 * stage, so they're genuine step functions. A linear line drawn between two
 * flat stretches would imply a smooth ramp that never happened. */
export function RevenueInPipelineChart({ data }: { data: RevenuePipelinePoint[] }) {
  const ct = useChartTheme();
  const currentExpected = data.length ? data[data.length - 1].expected : 0;
  const currentActual = data.length ? data[data.length - 1].actual : 0;

  return (
    <div className="flex h-full min-h-[220px] flex-col">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <StatHead color={EXPECTED_COLOR} label="Expected" value={currentExpected} />
        <StatHead color={ACTUAL_COLOR} label="Actual (Closed)" value={currentActual} />
      </div>

      <div className="mt-3 min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gRevenueExpected" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={EXPECTED_COLOR} stopOpacity={0.12} />
                <stop offset="100%" stopColor={EXPECTED_COLOR} stopOpacity={0.01} />
              </linearGradient>
              <linearGradient id="gRevenueActual" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={ACTUAL_COLOR} stopOpacity={0.16} />
                <stop offset="100%" stopColor={ACTUAL_COLOR} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={ct.gridStroke} vertical={false} />
            <XAxis dataKey="label" stroke={ct.axisStroke} fontSize={10} tickLine={false} axisLine={false} />
            <YAxis stroke={ct.axisStroke} fontSize={10} tickLine={false} axisLine={false} width={48} tickFormatter={formatShort} />
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
              type="stepAfter"
              dataKey="expected"
              name="Expected"
              stroke={EXPECTED_COLOR}
              fill="url(#gRevenueExpected)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5, strokeWidth: 2, stroke: ct.tooltipBg }}
              animationDuration={500}
            />
            <Area
              type="stepAfter"
              dataKey="actual"
              name="Actual (Closed)"
              stroke={ACTUAL_COLOR}
              fill="url(#gRevenueActual)"
              strokeWidth={2}
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
