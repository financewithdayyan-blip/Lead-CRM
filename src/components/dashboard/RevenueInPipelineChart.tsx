import { Area, AreaChart, CartesianGrid, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { useChartTheme } from '@/hooks/useChartTheme';

export interface RevenuePipelinePoint {
  iso: string;
  label: string;
  revenue: number;
}

const GOLD = '#C9A24B';

function formatShort(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(v % 1_000 === 0 ? 0 : 1)}k`;
  return `$${v}`;
}

const money = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** Total assignment fee sitting across every lead currently Under Contract,
 * reconstructed day by day from each lead's real stage-change history (see
 * DashboardPage's revenueInPipelineTrend) rather than just today's snapshot
 * — a lead that later moved to In Title/Closed, or fell through entirely,
 * still correctly shows in the days it really was under contract.
 *
 * Rendered as a step area, not a straight-line interpolation — the
 * underlying value only ever moves when a lead actually enters or leaves
 * Under Contract, so it's a genuine step function. A linear line drawn
 * between two flat stretches implied a smooth ramp that never happened. */
export function RevenueInPipelineChart({ data }: { data: RevenuePipelinePoint[] }) {
  const ct = useChartTheme();
  const current = data.length ? data[data.length - 1].revenue : 0;
  const start = data.length ? data[0].revenue : 0;
  const delta = current - start;
  const deltaUp = delta > 0;
  const deltaFlat = delta === 0;
  const last = data[data.length - 1];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="font-mono text-[28px] font-bold leading-none text-text">{money(current)}</div>
        {!deltaFlat && (
          <div
            className={`mb-0.5 flex items-center gap-1 text-[12.5px] font-semibold ${deltaUp ? 'text-success' : 'text-danger'}`}
          >
            {deltaUp ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
            {money(Math.abs(delta))} this period
          </div>
        )}
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gRevenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={GOLD} stopOpacity={0.12} />
              <stop offset="100%" stopColor={GOLD} stopOpacity={0.01} />
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
            formatter={(value: number) => [money(value), 'Revenue in Pipeline']}
          />
          <Area
            type="stepAfter"
            dataKey="revenue"
            stroke={GOLD}
            fill="url(#gRevenue)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, strokeWidth: 2, stroke: ct.tooltipBg }}
            animationDuration={500}
          />
          {last && (
            <ReferenceDot x={last.label} y={last.revenue} r={5} fill={GOLD} stroke={ct.tooltipBg} strokeWidth={2} isFront />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
