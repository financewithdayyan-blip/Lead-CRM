import { AreaChart, Area, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface DailyTrendPoint {
  iso: string;
  label: string;
  calls: number;
  voicemail: number;
  dead_declined: number;
  followupCombined: number;
}

// Split into its own lazy-loaded chunk - recharts is the single heaviest
// dependency in the app, and the dashboard shell shouldn't have to wait on
// it just to show stats cards and the lead list.
export function DailyActivityChart({ data }: { data: DailyTrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={270}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {[
            ['gCalls', '#3b82f6'],
            ['gVoicemail', '#f59e0b'],
            ['gDead', '#ef4444'],
            ['gFollowup', '#10b981'],
          ].map(([id, color]) => (
            <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.32} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          ))}
          <filter id="lineShadow" x="-20%" y="-40%" width="140%" height="200%">
            <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#0f172a" floodOpacity="0.18" />
          </filter>
        </defs>
        <CartesianGrid stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="label" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
        <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
        <Tooltip
          cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '4 4' }}
          contentStyle={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            fontSize: 12,
            boxShadow: '0 10px 25px -8px rgba(15,23,42,0.25)',
            padding: '8px 12px',
          }}
          itemStyle={{ padding: '1px 0' }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
        <Area
          type="linear"
          dataKey="calls"
          name="Total Calls"
          stroke="#3b82f6"
          fill="url(#gCalls)"
          strokeWidth={2.5}
          style={{ filter: 'url(#lineShadow)' }}
          dot={{ r: 3.5, strokeWidth: 2, stroke: '#fff', fill: '#3b82f6' }}
          activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff' }}
          animationDuration={600}
        />
        <Area
          type="linear"
          dataKey="voicemail"
          name="Voicemail"
          stroke="#f59e0b"
          fill="url(#gVoicemail)"
          strokeWidth={2.5}
          style={{ filter: 'url(#lineShadow)' }}
          dot={{ r: 3.5, strokeWidth: 2, stroke: '#fff', fill: '#f59e0b' }}
          activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff' }}
          animationDuration={600}
        />
        <Area
          type="linear"
          dataKey="dead_declined"
          name="Dead / Declined"
          stroke="#ef4444"
          fill="url(#gDead)"
          strokeWidth={2.5}
          style={{ filter: 'url(#lineShadow)' }}
          dot={{ r: 3.5, strokeWidth: 2, stroke: '#fff', fill: '#ef4444' }}
          activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff' }}
          animationDuration={600}
        />
        <Area
          type="linear"
          dataKey="followupCombined"
          name="Follow-Up + Initial Contact"
          stroke="#10b981"
          fill="url(#gFollowup)"
          strokeWidth={2.5}
          style={{ filter: 'url(#lineShadow)' }}
          dot={{ r: 3.5, strokeWidth: 2, stroke: '#fff', fill: '#10b981' }}
          activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff' }}
          animationDuration={600}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
