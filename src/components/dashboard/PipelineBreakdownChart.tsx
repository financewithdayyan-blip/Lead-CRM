import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '@/hooks/useChartTheme';

export interface PipelineBreakdownPoint {
  key: string;
  label: string;
  count: number;
  color: string;
}

interface ChartRow extends PipelineBreakdownPoint {
  /** Square-root of count, not the count itself — this stage census spans
   * orders of magnitude (thousands of Cold Leads next to single-digit
   * Negotiation/Contract counts), and a linear bar length collapses every
   * stage below the top two into an invisible sliver. Compressing the scale
   * keeps small-but-real stages visibly present while the biggest stage
   * still reads as biggest; the axis itself stays hidden since sqrt units
   * aren't meaningful on their own — labels always render the real count. */
  sqrt: number;
  pct: number;
}

function BreakdownTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartRow }> }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div
      className="rounded-[10px] border border-border bg-surface px-3 py-2 text-[12px] shadow-[0_10px_25px_-8px_rgba(11,30,51,0.25)]"
    >
      <div className="flex items-center gap-1.5 font-semibold text-text">
        <span className="h-2 w-2 rounded-full" style={{ background: row.color }} />
        {row.label}
      </div>
      <div className="mt-0.5 text-text-2">
        <span className="font-mono font-semibold tabular-nums text-text">{row.count.toLocaleString()}</span> leads ·{' '}
        {row.pct.toFixed(1)}% of total
      </div>
    </div>
  );
}

/** Full stage census as a ranked horizontal bar chart — every stage the
 * pipeline has ever put a lead in, largest first, not just the active
 * funnel (see PipelineFunnel for that narrower "Contacted onward" view). */
export function PipelineBreakdownChart({ data, total }: { data: PipelineBreakdownPoint[]; total: number }) {
  const ct = useChartTheme();
  const rows: ChartRow[] = data
    .filter((d) => d.count > 0)
    .map((d) => ({ ...d, sqrt: Math.sqrt(d.count), pct: total > 0 ? (d.count / total) * 100 : 0 }))
    .sort((a, b) => b.count - a.count);

  if (rows.length === 0) {
    return <div className="flex h-[160px] items-center justify-center text-[13px] text-text-3">No leads yet.</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(220, rows.length * 34)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 36, left: 0, bottom: 4 }} barCategoryGap="22%">
        <XAxis type="number" dataKey="sqrt" hide />
        <YAxis
          type="category"
          dataKey="label"
          stroke={ct.axisStroke}
          fontSize={11.5}
          tickLine={false}
          axisLine={false}
          width={112}
        />
        <Tooltip cursor={{ fill: 'rgba(21,104,168,0.06)' }} content={<BreakdownTooltip />} />
        <Bar dataKey="sqrt" radius={[0, 6, 6, 0]} maxBarSize={20} animationDuration={500}>
          {rows.map((r) => (
            <Cell key={r.key} fill={r.color} />
          ))}
          <LabelList
            dataKey="count"
            position="right"
            formatter={(v: number) => v.toLocaleString()}
            style={{ fontSize: 11.5, fontWeight: 600, fill: ct.textFill }}
            className="tabular-nums"
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
