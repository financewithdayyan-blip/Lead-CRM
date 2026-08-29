import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { useChartTheme } from '@/hooks/useChartTheme';

interface ActivityTrendPoint {
  iso: string;
  label: string;
  sent: number;
  replies: number;
  qualified: number;
}

const QUALIFIED_COLOR = '#a78bfa';

// Two stacked recharts instances sharing the same `data` array, categorical
// XAxis dataKey, and left/right margins — recharts computes identical band
// positions for each in both, so the bubble strip's dots line up under the
// exact day they belong to without any manual pixel math.
//
// Newly Qualified is deliberately not a third line here: its daily count
// (typically 0-4) is invisible next to SMS Sent (up to several hundred) on
// a shared y-scale — a real dual-magnitude problem, not a color problem.
// Encoding it as bubble size in its own lane instead means it reads
// regardless of how big the SMS/Replies numbers are.
export function PipelineActivityChart({ data }: { data: ActivityTrendPoint[] }) {
  const ct = useChartTheme();
  const maxQualified = Math.max(1, ...data.map((d) => d.qualified));

  return (
    <div>
      <ResponsiveContainer width="100%" height={230}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            {[
              ['gSent', '#0891b2'],
              ['gReplies', '#22d3ee'],
            ].map(([id, color]) => (
              <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.32} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke={ct.gridStroke} vertical={false} />
          <XAxis dataKey="label" stroke={ct.axisStroke} fontSize={10} tickLine={false} axisLine={false} />
          <YAxis stroke={ct.axisStroke} fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
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
          />
          <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
          <Area
            type="linear"
            dataKey="sent"
            name="SMS Sent"
            stroke="#0891b2"
            fill="url(#gSent)"
            strokeWidth={2.5}
            dot={{ r: 3.5, strokeWidth: 2, stroke: '#fff', fill: '#0ea5e9' }}
            activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff' }}
            animationDuration={600}
          />
          <Area
            type="linear"
            dataKey="replies"
            name="Replies"
            stroke="#22d3ee"
            fill="url(#gReplies)"
            strokeWidth={2.5}
            dot={{ r: 3.5, strokeWidth: 2, stroke: '#fff', fill: '#22d3ee' }}
            activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff' }}
            animationDuration={600}
          />
        </AreaChart>
      </ResponsiveContainer>

      <div className="mt-1 flex items-center gap-1.5 pl-1 text-[10.5px] text-text-3">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: QUALIFIED_COLOR }} />
        Newly Qualified — bubble size is how many that day (largest = {maxQualified})
      </div>
      <ResponsiveContainer width="100%" height={44}>
        <ScatterChart margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          {/* Every day goes into the Scatter, including the zero-qualified
              ones — not just for that XAxis category domain to exactly
              match the chart above (dropping zero days here would shrink
              the domain and throw off the alignment), a zero-value point
              also just renders at area 0, invisibly, via the ZAxis range
              floor below, so it costs nothing to include. */}
          <XAxis dataKey="label" type="category" allowDuplicatedCategory={false} hide />
          <YAxis type="number" dataKey="y" domain={[0, 1]} hide />
          <ZAxis type="number" dataKey="qualified" domain={[0, maxQualified]} range={[0, 500]} />
          <Tooltip
            cursor={false}
            contentStyle={{
              background: ct.tooltipBg,
              border: `1px solid ${ct.tooltipBorder}`,
              borderRadius: 10,
              fontSize: 12,
              boxShadow: '0 10px 25px -8px rgba(11,30,51,0.25)',
              padding: '8px 12px',
              color: ct.textFill,
            }}
            formatter={(value: number) => [value, 'Newly qualified']}
            labelFormatter={(label) => label}
          />
          <Scatter data={data.map((d) => ({ label: d.label, y: 0.5, qualified: d.qualified }))} fill={QUALIFIED_COLOR} fillOpacity={0.75} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
