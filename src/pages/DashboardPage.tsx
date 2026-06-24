import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, PhoneCall } from 'lucide-react';
import { AreaChart, Area, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLeads } from '@/hooks/useLeads';
import { useActivityFeed } from '@/hooks/useActivities';
import { useTags } from '@/hooks/useTags';
import { useAuth } from '@/contexts/AuthContext';
import { STAGE_CONFIG, STAGE_ORDER, type Profile } from '@/types/domain';
import { localIsoDate } from '@/lib/utils';

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
  allowStartSession = false,
}: {
  userId: string;
  profile: Profile | null;
  heading?: string;
  subtitle?: string;
  allowStartSession?: boolean;
}) {
  const { data: leads = [] } = useLeads(userId);
  const { data: activities = [] } = useActivityFeed(userId);
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

    const callsMade = calls.length;
    const dialedLeadIds = new Set(calls.map((a) => a.leadId));
    const dialedPct = total > 0 ? Math.round((dialedLeadIds.size / total) * 100) : 0;

    const outcomeCount = (key: string) => calls.filter((a) => (a.meta as { outcome?: string })?.outcome === key).length;
    const voicemailCount = outcomeCount('voicemail');
    const deadDeclinedOutcomeCount = outcomeCount('dead') + outcomeCount('declined');
    const followupCount = outcomeCount('followup');
    const conversations = outcomeCount('initial_contact') + followupCount;

    const contactRate = callsMade > 0 ? Math.round((conversations / callsMade) * 100) : 0;
    const voicemailRate = callsMade > 0 ? Math.round((voicemailCount / callsMade) * 100) : 0;
    const deadDeclinedRate = callsMade > 0 ? Math.round((deadDeclinedOutcomeCount / callsMade) * 100) : 0;
    const callsPerFollowup = followupCount > 0 ? (callsMade / followupCount).toFixed(1) : null;
    const callsPerConversation = conversations > 0 ? (callsMade / conversations).toFixed(1) : null;

    // No dedicated session log exists yet - approximate a "session" as a run of
    // calls with no gap longer than 20 minutes between consecutive dials.
    const callTimes = calls.map((a) => new Date(a.createdAt).getTime()).sort((a, b) => a - b);
    let totalSessions = 0;
    let lastTime: number | null = null;
    for (const t of callTimes) {
      if (lastTime === null || t - lastTime > 20 * 60 * 1000) totalSessions++;
      lastTime = t;
    }

    return {
      total,
      active,
      contracts,
      deadDeclined,
      conversionRate,
      callsToday,
      monthCalls,
      weekCalls,
      stageCounts,
      ratingCounts,
      tagCounts,
      callsMade,
      dialedPct,
      conversations,
      contactRate,
      voicemailCount,
      voicemailRate,
      deadDeclinedOutcomeCount,
      deadDeclinedRate,
      callsPerFollowup,
      callsPerConversation,
      totalSessions,
    };
  }, [leads, calls, tags]);

  const dailyTrend = useMemo(() => {
    const days: Array<{
      iso: string;
      label: string;
      calls: number;
      voicemail: number;
      dead_declined: number;
      followupCombined: number;
    }> = [];
    const today = new Date();
    for (let i = trendRange - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const iso = localIsoDate(d);
      days.push({
        iso,
        label: d.toLocaleDateString([], trendRange <= 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' }),
        calls: 0,
        voicemail: 0,
        dead_declined: 0,
        followupCombined: 0,
      });
    }
    const byIso = new Map(days.map((d) => [d.iso, d]));
    activities.forEach((a) => {
      const iso = localIsoDate(new Date(a.createdAt));
      const day = byIso.get(iso);
      if (!day) return;
      if (a.type === 'call') day.calls++;
      if (a.type === 'stage_change') {
        const to = (a.meta as { to?: unknown })?.to;
        if (to === 'voicemail') day.voicemail++;
        else if (to === 'dead_declined') day.dead_declined++;
        else if (to === 'followup' || to === 'initial_contact') day.followupCombined++;
      }
    });
    return days;
  }, [activities, trendRange]);

  const heatmap = useMemo(() => {
    const byDay = new Map<string, number>();
    const callTimesByDay = new Map<string, number[]>();
    activities.forEach((a) => {
      const iso = localIsoDate(new Date(a.createdAt));
      byDay.set(iso, (byDay.get(iso) || 0) + 1);
      if (a.type === 'call') {
        const arr = callTimesByDay.get(iso) ?? [];
        arr.push(new Date(a.createdAt).getTime());
        callTimesByDay.set(iso, arr);
      }
    });

    function sessionsForDay(iso: string) {
      const times = callTimesByDay.get(iso);
      if (!times || times.length === 0) return 0;
      const sorted = [...times].sort((a, b) => a - b);
      let sessions = 1;
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] - sorted[i - 1] > 20 * 60 * 1000) sessions++;
      }
      return sessions;
    }

    const today = new Date();
    const jan1 = new Date(today.getFullYear(), 0, 1);
    const startDate = new Date(jan1.getFullYear(), jan1.getMonth(), jan1.getDate() - jan1.getDay());
    const weeksToToday = Math.ceil((today.getTime() - startDate.getTime()) / (7 * 86400000)) + 1;
    const max = Math.max(1, ...Array.from(byDay.values()));
    const todayTime = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

    const cols: Array<Array<{ iso: string; count: number; calls: number; sessions: number; isFuture: boolean; isToday: boolean }>> = [];
    for (let w = 0; w < weeksToToday; w++) {
      const cells = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + w * 7 + d);
        const iso = localIsoDate(date);
        cells.push({
          iso,
          count: byDay.get(iso) || 0,
          calls: (callTimesByDay.get(iso) ?? []).length,
          sessions: sessionsForDay(iso),
          isFuture: date.getTime() > todayTime,
          isToday: date.getTime() === todayTime,
        });
      }
      cols.push(cells);
    }

    const activeDays = Array.from(byDay.values()).filter((c) => c > 0).length;

    let currentStreak = 0;
    {
      const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      while (cursor.getTime() >= jan1.getTime()) {
        if ((byDay.get(localIsoDate(cursor)) ?? 0) > 0) {
          currentStreak++;
          cursor.setDate(cursor.getDate() - 1);
        } else {
          break;
        }
      }
    }

    let bestStreak = 0;
    {
      let run = 0;
      const cursor = new Date(jan1);
      while (cursor.getTime() <= todayTime) {
        if ((byDay.get(localIsoDate(cursor)) ?? 0) > 0) {
          run++;
          bestStreak = Math.max(bestStreak, run);
        } else {
          run = 0;
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    const dayOfWeek = today.getDay();
    const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dayOfWeek);
    let thisWeekActive = 0;
    for (let i = 0; i <= dayOfWeek; i++) {
      const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i);
      if ((byDay.get(localIsoDate(d)) ?? 0) > 0) thisWeekActive++;
    }

    return { cols, max, activeDays, currentStreak, bestStreak, thisWeekActive, thisWeekTotal: dayOfWeek + 1 };
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

  function formatFullDate(iso: string) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text">{heading}</h1>
          <p className="text-sm text-text-3">{subtitle}</p>
        </div>
        {allowStartSession ? (
          <Link to="/session" className="btn btn-primary shrink-0">
            <PhoneCall size={15} /> Start Session
          </Link>
        ) : (
          <button
            disabled
            title="You can only start a calling session for your own account."
            className="btn shrink-0 cursor-not-allowed opacity-50"
          >
            <PhoneCall size={15} /> Start Session
          </button>
        )}
      </div>

      {leads.length === 0 ? (
        <div className="card text-center text-text-3">Add some leads to see stats here.</div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Total Leads" value={stats.total} sub={`${stats.dialedPct}% dialed`} />
            <StatCard label="Calls Made" value={stats.callsMade} sub={`out of ${stats.total} leads`} color="#4f46e5" />
            <StatCard label="Conversations" value={stats.conversations} sub="initial + follow-ups" color="#a78bfa" />
            <StatCard
              label="Contact Rate"
              value={`${stats.contactRate}%`}
              sub={`${stats.conversations} contacts of ${stats.callsMade} dialed`}
              color="#10b981"
            />
            <StatCard
              label="Conversion Rate"
              value={`${stats.conversionRate}%`}
              sub={`${stats.contracts} contracts from ${stats.total} leads`}
              color="#10b981"
            />
            <StatCard label="Voicemail Rate" value={`${stats.voicemailRate}%`} sub={`${stats.voicemailCount} voicemails left`} color="#f59e0b" />
            <StatCard
              label="Dead / Declined Rate"
              value={`${stats.deadDeclinedRate}%`}
              sub={`${stats.deadDeclinedOutcomeCount} not interested`}
              color="#ef4444"
            />
            <StatCard label="Total Sessions" value={stats.totalSessions} sub={`${stats.totalSessions} calling sessions run`} color="#4f46e5" />
            <StatCard label="Calls Today" value={stats.callsToday} sub="logged today" color="#4f46e5" />
            <StatCard label="Calls / Follow-Up" value={stats.callsPerFollowup ?? '—'} sub="avg dials to get a follow-up" color="#f59e0b" />
            <StatCard
              label="Calls / Conversation"
              value={stats.callsPerConversation ?? '—'}
              sub="avg dials to get a conversation"
              color="#f59e0b"
            />
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
            <ResponsiveContainer width="100%" height={270}>
              <AreaChart data={dailyTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Current Streak"
              value={heatmap.currentStreak}
              sub={heatmap.currentStreak === 0 ? 'Start today!' : `${heatmap.currentStreak} day${heatmap.currentStreak !== 1 ? 's' : ''} in a row`}
              color="#f59e0b"
            />
            <StatCard label="Active Days" value={heatmap.activeDays} sub="active days this year" color="#10b981" />
            <StatCard label="Best Streak" value={heatmap.bestStreak} sub="personal best" color="#06b6d4" />
            <StatCard
              label="This Week"
              value={`${heatmap.thisWeekActive}/${heatmap.thisWeekTotal}`}
              sub="days active so far"
              color="#a78bfa"
            />
          </div>

          <div className="card overflow-x-auto">
            <h3 className="mb-3 text-sm font-semibold text-text">Activity — {new Date().getFullYear()}</h3>
            <div className="flex gap-[3px]">
              {heatmap.cols.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-[3px]">
                  {week.map((cell) => (
                    <div key={cell.iso} className="group relative">
                      <div
                        className={`h-[11px] w-[11px] rounded-[2px] transition-transform group-hover:scale-125 ${cell.isToday ? 'ring-1 ring-primary' : ''}`}
                        style={{ background: cell.isFuture ? 'transparent' : intensity(cell.count, heatmap.max) }}
                      />
                      {!cell.isFuture && (
                        <div className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-20 w-48 -translate-x-1/2 rounded-lg border border-border bg-surface p-3 text-left opacity-0 shadow-popover transition-opacity group-hover:opacity-100">
                          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-text">
                            <MapPin size={12} className="text-primary" />
                            {formatFullDate(cell.iso)}
                          </div>
                          <div className="my-1.5 border-t border-border" />
                          <div className="flex items-center justify-between text-[11px] text-text-2">
                            <span>Total Calls</span>
                            <span className="font-medium text-text">{cell.calls || '—'}</span>
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-text-2">
                            <span>Sessions</span>
                            <span className="font-medium text-text">{cell.sessions || '—'}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
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
  return <DashboardView userId={session.user.id} profile={profile} allowStartSession />;
}
