import { AreaChart, Area, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '@/hooks/useChartTheme';

interface ActivityTrendPoint {
  iso: string;
  label: string;
  sent: number;
  replies: number;
  qualified: number;
  calls: number;
}

// One chart for the whole pipeline — SMS sends, replies, and calls to
// qualified leads plotted together, instead of separate charts per channel.
// Its own lazy chunk since recharts is the heaviest dependency in the app.
export function PipelineActivityChart({ data }: { data: ActivityTrendPoint[] }) {
  const ct = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {[
            ['gSent', '#0891b2'],
            ['gReplies', '#22d3ee'],
            ['gQualified', '#a78bfa'],
            ['gCalls', '#fb923c'],
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
        <Area
          type="linear"
          dataKey="qualified"
          name="Newly Qualified"
          stroke="#a78bfa"
          fill="url(#gQualified)"
          strokeWidth={2.5}
          dot={{ r: 3.5, strokeWidth: 2, stroke: '#fff', fill: '#a78bfa' }}
          activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff' }}
          animationDuration={600}
        />
        <Area
          type="linear"
          dataKey="calls"
          name="Calls to Qualified Leads"
          stroke="#fb923c"
          fill="url(#gCalls)"
          strokeWidth={2.5}
          dot={{ r: 3.5, strokeWidth: 2, stroke: '#fff', fill: '#fb923c' }}
          activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff' }}
          animationDuration={600}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
