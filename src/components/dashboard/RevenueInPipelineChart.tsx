import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '@/hooks/useChartTheme';

export interface RevenuePipelinePoint {
  iso: string;
  label: string;
  revenue: number;
}

function formatShort(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(v % 1_000 === 0 ? 0 : 1)}k`;
  return `$${v}`;
}

/** Total assignment fee sitting across every lead currently Under Contract,
 * reconstructed day by day from each lead's real stage-change history (see
 * DashboardPage's revenueInPipelineTrend) rather than just today's snapshot
 * — a lead that later moved to In Title/Closed, or fell through entirely,
 * still correctly shows in the days it really was under contract. */
export function RevenueInPipelineChart({ data }: { data: RevenuePipelinePoint[] }) {
  const ct = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="gRevenue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#C9A24B" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#C9A24B" stopOpacity={0.02} />
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
          formatter={(value: number) => [value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }), 'Revenue in Pipeline']}
        />
        <Area
          type="linear"
          dataKey="revenue"
          stroke="#C9A24B"
          fill="url(#gRevenue)"
          strokeWidth={2.5}
          dot={{ r: 3.5, strokeWidth: 2, stroke: '#fff', fill: '#C9A24B' }}
          activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff' }}
          animationDuration={600}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
