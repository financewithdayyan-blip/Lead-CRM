import { useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useLeads } from '@/hooks/useLeads';
import { useActivityFeed, useRecentActivities } from '@/hooks/useActivities';
import { useTags } from '@/hooks/useTags';
import { useAuth } from '@/contexts/AuthContext';
import { STAGE_CONFIG, STAGE_ORDER, type Profile } from '@/types/domain';
import { formatDateTime, localIsoDate } from '@/lib/utils';

const ACTIVITY_LABEL: Record<string, string> = {
  note: 'Note added',
  call: 'Call logged',
  email: 'Email sent',
  meeting: 'Meeting',
  sms: 'Text sent',
  stage_change: 'Stage changed',
};

function BarRow({ label, count, max, color }: { label: string; count: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="w-32 shrink-0 truncate text-[12px] text-text-2">{label}</div>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="w-8 shrink-0 text-right text-[12px] text-text-3">{count}</div>
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub: string; color?: string }) {
  return (
    <div className="card !p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">{label}</div>
      <div className="mt-1 text-2xl font-semibold" style={{ color: color ?? '#0f172a' }}>
        {value}
      </div>
      <div className="mt-0.5 text-[12px] text-text-3">{sub}</div>
    </div>
  );
}

function GoalBar({ label, done, goal, periodLabel }: { label: string; done: number; goal: number; periodLabel: string }) {
  const pct = Math.min(100, Math.round((done / goal) * 100));
  const isDone = done >= goal;
  const color = isDone ? '#10b981' : pct >= 70 ? '#4f46e5' : pct >= 40 ? '#f59e0b' : '#ef4444';
  return (
    <div className="card !p-4">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">
          {label} <span className="text-text-3">· {periodLabel}</span>
        </div>
        <div className="text-[12px] font-semibold" style={{ color }}>
          {isDone ? 'Goal reached' : `${pct}%`}
        </div>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="mt-1.5 text-[12px] text-text-2">
        {done.toLocaleString()} / {goal.toLocaleString()}
      </div>
    </div>
  );
}

export function DashboardView({
  userId,
  profile,
  heading = 'Dashboard',
  subtitle = 'Your pipeline and activity at a glance',
}: {
  userId: string;
  profile: Profile | null;
  heading?: string;
  subtitle?: string;
}) {
  const { data: leads = [] } = useLeads(userId);
  const { data: activities = [] } = useActivityFeed(userId);
  const { data: recent = [] } = useRecentActivities(userId);
  const { data: tags = [] } = useTags(userId);

  const [trendRange, setTrendRange] = useState<7 | 30>(7);

  const calls = useMemo(() => activities.filter((a) => a.type === 'call'), [activities]);

  const stats = useMemo(() => {
    const total = leads.length;
    const active = leads.filter((l) => ['initial_contact', 'followup', 'negotiation'].includes(l.stage)).length;
    const contracts = leads.filter((l) => l.stage === 'contract').length;
    const deadDeclined = leads.filter((l) => l.stage === 'dead_declined').length;
    const conversionRate = total > 0 ? Math.round((contracts / total) * 100) : 0;

    const todayIso = localIsoDate(new Date());
    const callsToday = calls.filter((a) => localIsoDate(new Date(a.createdAt)) === todayIso).length;

    const now = new Date();
    const monthCalls = calls.filter((a) => {
      const d = new Date(a.createdAt);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length;

    const dayOfWeek = now.getDay();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);
    const weekCalls = calls.filter((a) => new Date(a.createdAt) >= weekStart).length;

    const stageCounts: Record<string, number> = {};
    STAGE_ORDER.forEach((s) => (stageCounts[s] = 0));
    leads.forEach((l) => (stageCounts[l.stage] = (stageCounts[l.stage] || 0) + 1));

    const ratingCounts = [1, 2, 3, 4, 5].map((s) => leads.filter((l) => l.rating === s).length);

    const tagCounts = tags
      .map((t) => ({ tag: t, count: leads.filter((l) => l.tagIds.includes(t.id)).length }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count);

    return { total, active, contracts, deadDeclined, conversionRate, callsToday, monthCalls, weekCalls, stageCounts, ratingCounts, tagCounts };
  }, [leads, calls, tags]);

  const dailyTrend = useMemo(() => {
    const days: Array<{ iso: string; label: string; calls: number; activity: number }> = [];
    const today = new Date();
    for (let i = trendRange - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const iso = localIsoDate(d);
      days.push({
        iso,
        label: d.toLocaleDateString([], trendRange <= 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' }),
        calls: 0,
        activity: 0,
      });
    }
    const byIso = new Map(days.map((d) => [d.iso, d]));
    activities.forEach((a) => {
      const iso = localIsoDate(new Date(a.createdAt));
      const day = byIso.get(iso);
      if (!day) return;
      day.activity++;
      if (a.type === 'call') day.calls++;
    });
    return days;
  }, [activities, trendRange]);

  const heatmap = useMemo(() => {
    const byDay = new Map<string, number>();
    activities.forEach((a) => {
      const iso = localIsoDate(new Date(a.createdAt));
      byDay.set(iso, (byDay.get(iso) || 0) + 1);
    });
    const today = new Date();
    const jan1 = new Date(today.getFullYear(), 0, 1);
    const startDate = new Date(jan1.getFullYear(), jan1.getMonth(), jan1.getDate() - jan1.getDay());
    const weeksToToday = Math.ceil((today.getTime() - startDate.getTime()) / (7 * 86400000)) + 1;
    const max = Math.max(1, ...Array.from(byDay.values()));
    const todayTime = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

    const cols: Array<Array<{ iso: string; count: number; isFuture: boolean; isToday: boolean }>> = [];
    for (let w = 0; w < weeksToToday; w++) {
      const cells = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + w * 7 + d);
        const iso = localIsoDate(date);
        cells.push({ iso, count: byDay.get(iso) || 0, isFuture: date.getTime() > todayTime, isToday: date.getTime() === todayTime });
      }
      cols.push(cells);
    }
    return { cols, max };
  }, [activities]);

  const maxStage = Math.max(...Object.values(stats.stageCounts), 1);
  const maxRating = Math.max(...stats.ratingCounts, 1);
  const maxTag = Math.max(...stats.tagCounts.map((x) => x.count), 1);

  function intensity(count: number, max: number) {
    if (count === 0) return '#f1f5f9';
    const level = Math.min(5, Math.max(1, Math.ceil((count / max) * 5)));
    const alpha = 0.15 + level * 0.17;
    return `rgba(79,70,229,${alpha.toFixed(2)})`;
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-text">{heading}</h1>
        <p className="text-sm text-text-3">{subtitle}</p>
      </div>

      {leads.length === 0 ? (
        <div className="card text-center text-text-3">Add some leads to see stats here.</div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Total Leads" value={stats.total} sub={`${stats.active} active in pipeline`} />
            <StatCard label="Calls Today" value={stats.callsToday} sub="logged today" color="#4f46e5" />
            <StatCard label="Contracts" value={stats.contracts} sub={`${stats.conversionRate}% conversion`} color="#10b981" />
            <StatCard label="Dead / Declined" value={stats.deadDeclined} sub="not interested" color="#ef4444" />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <GoalBar label="Daily Call Goal" done={stats.callsToday} goal={profile?.dailyGoal ?? 20} periodLabel="today" />
            <GoalBar
              label="Monthly Call Goal"
              done={stats.monthCalls}
              goal={profile?.monthlyGoal ?? 400}
              periodLabel={new Date().toLocaleDateString([], { month: 'long', year: 'numeric' })}
            />
          </div>

          <div className="card">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text">Daily Activity</h3>
              <div className="flex gap-1">
                {([7, 30] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setTrendRange(r)}
                    className={`btn !px-2.5 !py-1 text-[12px] ${trendRange === r ? '!border-primary !text-primary-text' : ''}`}
                  >
                    {r}D
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={dailyTrend}>
                <defs>
                  <linearGradient id="gActivity" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#4f46e5" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
                <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="activity" name="Total Activity" stroke="#4f46e5" fill="url(#gActivity)" strokeWidth={2} />
                <Area type="monotone" dataKey="calls" name="Calls" stroke="#10b981" fill="transparent" strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="card">
              <h3 className="mb-2 text-sm font-semibold text-text">Pipeline Breakdown</h3>
              {STAGE_ORDER.map((s) => (
                <BarRow key={s} label={STAGE_CONFIG[s].label} count={stats.stageCounts[s]} max={maxStage} color={STAGE_CONFIG[s].color} />
              ))}
            </div>
            <div className="card">
              <h3 className="mb-2 text-sm font-semibold text-text">Rating Breakdown</h3>
              {[5, 4, 3, 2, 1].map((s) => (
                <BarRow key={s} label={'★'.repeat(s) + '☆'.repeat(5 - s)} count={stats.ratingCounts[s - 1]} max={maxRating} color="#f59e0b" />
              ))}
            </div>
            <div className="card">
              <h3 className="mb-2 text-sm font-semibold text-text">Tag Breakdown</h3>
              {stats.tagCounts.length === 0 && <div className="text-[13px] text-text-3">No tagged leads yet.</div>}
              {stats.tagCounts.map(({ tag, count }) => (
                <BarRow key={tag.id} label={tag.name} count={count} max={maxTag} color={tag.colorText} />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="card overflow-x-auto lg:col-span-2">
              <h3 className="mb-3 text-sm font-semibold text-text">Activity — {new Date().getFullYear()}</h3>
              <div className="flex gap-[3px]">
                {heatmap.cols.map((week, wi) => (
                  <div key={wi} className="flex flex-col gap-[3px]">
                    {week.map((cell) => (
                      <div
                        key={cell.iso}
                        title={`${cell.iso}: ${cell.count} activit${cell.count !== 1 ? 'ies' : 'y'}`}
                        className={`h-[11px] w-[11px] rounded-[2px] ${cell.isToday ? 'ring-1 ring-primary' : ''}`}
                        style={{ background: cell.isFuture ? 'transparent' : intensity(cell.count, heatmap.max) }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <h3 className="mb-3 text-sm font-semibold text-text">Recent Activity</h3>
              {recent.length === 0 && <div className="text-[13px] text-text-3">No activity yet.</div>}
              <div className="space-y-3">
                {recent.map((a) => (
                  <div key={a.id} className="text-[12px]">
                    <div className="font-medium text-text">{ACTIVITY_LABEL[a.type]}{a.leadName ? ` · ${a.leadName}` : ''}</div>
                    <div className="text-text-3">{formatDateTime(a.createdAt)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function DashboardPage() {
  const { session, profile } = useAuth();
  if (!session) return null;
  return <DashboardView userId={session.user.id} profile={profile} />;
}
