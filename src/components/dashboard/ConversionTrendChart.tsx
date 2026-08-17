import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface ConversionTrendPoint {
  month: string;
  leadCount: number;
  dealCount: number;
  conversionPct: number;
}

// Bars are lead volume per creation-month (left axis), the line is what
// share of that month's cohort has since reached Contract-or-further (right
// axis) — two very different scales, so a dual-axis combo chart instead of
// forcing them onto one. Its own lazy chunk, same reasoning as the other
// dashboard charts (recharts is the heaviest dependency in the app).
export function ConversionTrendChart({ data }: { data: ConversionTrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="month" stroke="#8693A1" fontSize={10} tickLine={false} axisLine={false} />
        <YAxis yAxisId="leads" stroke="#8693A1" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} width={32} />
        <YAxis
          yAxisId="pct"
          orientation="right"
          stroke="#10b981"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          width={36}
          tickFormatter={(v) => `${v}%`}
        />
        <Tooltip
          cursor={{ fill: '#f1f5f9' }}
          contentStyle={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            fontSize: 12,
            boxShadow: '0 10px 25px -8px rgba(11,30,51,0.25)',
            padding: '8px 12px',
          }}
          formatter={(value, name) => (name === 'Conversion Rate' ? [`${value}%`, name] : [value, name])}
        />
        <Bar yAxisId="leads" dataKey="leadCount" name="Leads Created" fill="#BBD8EC" radius={[3, 3, 0, 0]} />
        <Line
          yAxisId="pct"
          type="monotone"
          dataKey="conversionPct"
          name="Conversion Rate"
          stroke="#10b981"
          strokeWidth={2.5}
          dot={{ r: 3.5, strokeWidth: 2, stroke: '#fff', fill: '#10b981' }}
          activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff' }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
