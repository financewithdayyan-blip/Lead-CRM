import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface CallTrendPoint {
  iso: string;
  label: string;
  totalCalls: number;
  voicemails: number;
  dead: number;
  qualified: number;
}

// The caller-facing counterpart to PipelineActivityChart — same lazy chunk
// pattern (recharts is the heaviest dependency in the app), but plotted as
// actual lines rather than filled areas, and driven by call outcomes instead
// of SMS activity since callers never see SMS data.
export function CallProgressChart({ data }: { data: CallTrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="label" stroke="#8693A1" fontSize={10} tickLine={false} axisLine={false} />
        <YAxis stroke="#8693A1" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
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
        />
        <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
        <Line
          type="linear"
          dataKey="totalCalls"
          name="Total Calls"
          stroke="#1568A8"
          strokeWidth={2.5}
          dot={{ r: 3.5, strokeWidth: 2, stroke: '#fff', fill: '#1568A8' }}
          activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff' }}
          animationDuration={600}
        />
        <Line
          type="linear"
          dataKey="voicemails"
          name="Voicemails"
          stroke="#f59e0b"
          strokeWidth={2.5}
          dot={{ r: 3.5, strokeWidth: 2, stroke: '#fff', fill: '#f59e0b' }}
          activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff' }}
          animationDuration={600}
        />
        <Line
          type="linear"
          dataKey="dead"
          name="Dead"
          stroke="#ef4444"
          strokeWidth={2.5}
          dot={{ r: 3.5, strokeWidth: 2, stroke: '#fff', fill: '#ef4444' }}
          activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff' }}
          animationDuration={600}
        />
        <Line
          type="linear"
          dataKey="qualified"
          name="Qualified"
          stroke="#a78bfa"
          strokeWidth={2.5}
          dot={{ r: 3.5, strokeWidth: 2, stroke: '#fff', fill: '#a78bfa' }}
          activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff' }}
          animationDuration={600}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
