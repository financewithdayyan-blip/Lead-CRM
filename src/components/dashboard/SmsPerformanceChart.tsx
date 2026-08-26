import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

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
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="label" stroke="#8693A1" fontSize={10} tickLine={false} axisLine={false} />
        <YAxis
          stroke="#8693A1"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          width={36}
          domain={[0, 100]}
          tickFormatter={(v) => `${v}%`}
        />
        <Tooltip
          cursor={{ stroke: '#8693A1', strokeWidth: 1, strokeDasharray: '4 4' }}
          contentStyle={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            fontSize: 12,
            boxShadow: '0 10px 25px -8px rgba(11,30,51,0.25)',
            padding: '8px 12px',
          }}
          itemStyle={{ padding: '1px 0' }}
          formatter={(value: number, name: string, item: any) => {
            const { sent, delivered, replies } = item.payload as SmsPerformancePoint;
            if (name === 'Delivery Rate') return [`${value.toFixed(1)}% (${delivered}/${sent})`, name];
            return [`${value.toFixed(1)}% (${replies}/${delivered})`, name];
          }}
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
