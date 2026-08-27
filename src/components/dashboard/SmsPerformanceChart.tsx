import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '@/hooks/useChartTheme';

export interface SmsPerformancePoint {
  iso: string;
  label: string;
  deliveryRate: number | null;
  replyRate: number | null;
  sent: number;
  delivered: number;
  replies: number;
}

/** Delivery rate and reply rate over time, matching Zoom's own SMS report
 * definitions exactly: delivery rate = delivered / sent, reply rate =
 * replies / delivered (not / sent — a reply can only happen to a message
 * that actually arrived). A day with no sends renders a gap, not a false 0%. */
export function SmsPerformanceChart({ data }: { data: SmsPerformancePoint[] }) {
  const ct = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={ct.gridStroke} vertical={false} />
        <XAxis dataKey="label" stroke={ct.axisStroke} fontSize={10} tickLine={false} axisLine={false} />
        <YAxis
          stroke={ct.axisStroke}
          fontSize={10}
          tickLine={false}
          axisLine={false}
          width={36}
          domain={[0, 100]}
          tickFormatter={(v) => `${v}%`}
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
          formatter={(value: number, name: string) => [`${value.toFixed(1)}%`, name]}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
        <Line
          type="linear"
          dataKey="deliveryRate"
          name="Delivery Rate"
          stroke="#0891b2"
          strokeWidth={2.5}
          dot={{ r: 3.5, strokeWidth: 2, stroke: '#fff', fill: '#0891b2' }}
          activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff' }}
          connectNulls={false}
          animationDuration={600}
        />
        <Line
          type="linear"
          dataKey="replyRate"
          name="Reply Rate"
          stroke="#C9A24B"
          strokeWidth={2.5}
          dot={{ r: 3.5, strokeWidth: 2, stroke: '#fff', fill: '#C9A24B' }}
          activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff' }}
          connectNulls={false}
          animationDuration={600}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
