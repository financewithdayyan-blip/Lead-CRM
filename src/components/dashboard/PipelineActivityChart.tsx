import {
  Area,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Scatter,
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

const SENT_COLOR = '#0891b2';
const REPLIES_COLOR = '#22d3ee';
const QUALIFIED_COLOR = '#a78bfa';

function StatHead({ color, label, value }: { color: string; label: string; value: number | string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="text-[11px] text-text-3">{label}</span>
      <span className="font-mono text-[15px] font-bold text-text">{value.toLocaleString()}</span>
    </div>
  );
}

/** One chart for the whole pipeline, styled the same way as Revenue in
 * Pipeline — thin 2px lines, no dot on every point, a light ~10% fill wash
 * — with period totals up top standing in for a legend (a dot + label +
 * number per series reads as both at once).
 *
 * Newly Qualified rides directly on the chart as bubbles on the Replies
 * line (bigger bubble = more leads qualified that day, no bubble = zero)
 * rather than a third line or a separate strip below — its size is the
 * whole encoding, so it never needs its own y-scale the way a line would,
 * and sitting on the Replies point tells the real story: no reply, no
 * qualifying happens. All three series share one ComposedChart/data array,
 * so a bubble's x-position can't drift from its real date. */
export function PipelineActivityChart({ data }: { data: ActivityTrendPoint[] }) {
  const ct = useChartTheme();
  const maxQualified = Math.max(1, ...data.map((d) => d.qualified));
  const totalSent = data.reduce((s, d) => s + d.sent, 0);
  const totalReplies = data.reduce((s, d) => s + d.replies, 0);
  const totalQualified = data.reduce((s, d) => s + d.qualified, 0);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <StatHead color={SENT_COLOR} label="SMS Sent" value={totalSent} />
        <StatHead color={REPLIES_COLOR} label="Replies" value={totalReplies} />
        <StatHead color={QUALIFIED_COLOR} label="Newly Qualified" value={totalQualified} />
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gSent" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SENT_COLOR} stopOpacity={0.12} />
              <stop offset="100%" stopColor={SENT_COLOR} stopOpacity={0.01} />
            </linearGradient>
            <linearGradient id="gReplies" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={REPLIES_COLOR} stopOpacity={0.12} />
              <stop offset="100%" stopColor={REPLIES_COLOR} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={ct.gridStroke} vertical={false} />
          <XAxis dataKey="label" stroke={ct.axisStroke} fontSize={10} tickLine={false} axisLine={false} />
          <YAxis stroke={ct.axisStroke} fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} width={32} />
          {/* Zero-qualified days stay in the Scatter's own data (area 0,
              invisible) rather than being filtered out — that keeps every
              bubble's index-aligned with the real day it belongs to. */}
          <ZAxis dataKey="qualified" domain={[0, maxQualified]} range={[0, 450]} />
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
            // The bubble's own y-value is borrowed from "replies" so it sits
            // on that line — its tooltip line has to read the real
            // qualified count back out of the point's own payload instead.
            formatter={(value: number, name: string, entry: any) =>
              name === 'Newly Qualified' ? [entry?.payload?.qualified ?? 0, name] : [value, name]
            }
          />
          <Area
            type="linear"
            dataKey="sent"
            name="SMS Sent"
            stroke={SENT_COLOR}
            fill="url(#gSent)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, strokeWidth: 2, stroke: ct.tooltipBg }}
            animationDuration={500}
          />
          <Area
            type="linear"
            dataKey="replies"
            name="Replies"
            stroke={REPLIES_COLOR}
            fill="url(#gReplies)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, strokeWidth: 2, stroke: ct.tooltipBg }}
            animationDuration={500}
          />
          <Scatter
            data={data.map((d) => ({ label: d.label, y: d.replies, qualified: d.qualified }))}
            dataKey="y"
            name="Newly Qualified"
            fill={QUALIFIED_COLOR}
            fillOpacity={0.6}
            stroke={QUALIFIED_COLOR}
            strokeWidth={1}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
