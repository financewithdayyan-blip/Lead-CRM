import { lazy, Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, MapPin, PhoneCall } from 'lucide-react';
import { useLeads } from '@/hooks/useLeads';
import { useActivityFeed } from '@/hooks/useActivities';
import { useTags } from '@/hooks/useTags';
import { useAuth } from '@/contexts/AuthContext';
import { STAGE_CONFIG, STAGE_ORDER, type Profile } from '@/types/domain';
import { localIsoDate } from '@/lib/utils';
import { DailyBriefingModal } from '@/components/daily/DailyBriefingModal';

const DailyActivityChart = lazy(() =>
  import('@/components/dashboard/DailyActivityChart').then((m) => ({ default: m.DailyActivityChart })),
);

const WEEKDAY_LABELS = ['Sun', '', 'Tue', '', 'Thu', '', 'Sat'];

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
  onOpenBriefing,
}: {
  userId: string;
  profile: Profile | null;
  heading?: string;
  subtitle?: string;
  allowStartSession?: boolean;
  onOpenBriefing?: () => void;
}) {
  const { data: leads = [] } = useLeads(userId);
  const { data: activities = [] } = useActivityFeed(userId);
  const { data: tags = [] } = useTags(userId);

  const [trendRange, setTrendRange] = useState<7 | 30>(7);

  const calls = useMemo(() => activities.filter((a) => a.type === 'call'), [activities]);

  const stats = useMemo(() => {
    const total = leads.length;
    // Leads still sitting at 'new' haven't had a call outcome selected yet,
    // so they shouldn't dilute rate KPIs like voicemail/dead/contact rate.
    const calledLeadsCount = leads.filter((l) => l.stage !== 'new').length;
    const active = leads.filter((l) => ['initial_contact', 'followup', 'negotiation'].includes(l.stage)).length;
    const contracts = leads.filter((l) => l.stage === 'contract').length;
    const deadDeclined = leads.filter((l) => l.stage === 'dead_declined').length;
    const conversionRate = calledLeadsCount > 0 ? Math.round((contracts / calledLeadsCount) * 100) : 0;

    const todayIso = localIsoDate(new Date());
    const callsToday = calls.filter((a) => localIsoDate(new Date(a.createdAt)) === todayIso).length;

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
    const monthCalls = calls.filter((a) => {
      const d = new Date(a.createdAt);
      return d >= monthStart && d < nextMonthStart;
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

    // Pipeline snapshot (matches the Pipeline Breakdown panel) - very few real
    // calls have an outcome logged yet, so these rate cards read off each
    // lead's current stage rather than the sparse per-call outcome data.
    const voicemailCount = leads.filter((l) => l.stage === 'voicemail').length;
    const deadDeclinedOutcomeCount = leads.filter((l) => l.stage === 'dead_declined').length;
    const pipelineInitialContactCount = leads.filter((l) => l.stage === 'initial_contact').length;
    const pipelineFollowupCount = leads.filter((l) => l.stage === 'followup').length;
    const conversations = pipelineInitialContactCount + pipelineFollowupCount;

    const contactRate = calledLeadsCount > 0 ? Math.round((conversations / calledLeadsCount) * 100) : 0;
    const voicemailRate = calledLeadsCount > 0 ? Math.round((voicemailCount / calledLeadsCount) * 100) : 0;
    const deadDeclinedRate = calledLeadsCount > 0 ? Math.round((deadDeclinedOutcomeCount / calledLeadsCount) * 100) : 0;

    // Calling efficiency (dials per outcome) stays based on actual logged
    // call outcomes, so it stays blank until enough real calls are logged.
    const outcomeCount = (key: string) => calls.filter((a) => (a.meta as { outcome?: string })?.outcome === key).length;
    const followupCount = outcomeCount('followup');
    const callConversations = outcomeCount('initial_contact') + followupCount;
    const declinedCount = outcomeCount('declined');
    const callsPerFollowup = followupCount > 0 ? (callsMade / followupCount).toFixed(1) : null;
    const callsPerConversation = callConversations > 0 ? (callsMade / callConversations).toFixed(1) : null;
    const pickupDenominator = outcomeCount('initial_contact') + followupCount + declinedCount;
    const pickupRatio = pickupDenominator > 0 ? (callsMade / pickupDenominator).toFixed(1) : null;

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
      calledLeadsCount,
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
      pickupRatio,
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
      if (a.type !== 'stage_change') return;
      const iso = localIsoDate(new Date(a.createdAt));
      const day = byIso.get(iso);
      if (!day) return;
      const to = (a.meta as { to?: string })?.to;
      if (to === 'voicemail') day.voicemail++;
      else if (to === 'dead_declined') day.dead_declined++;
      else if (to === 'followup' || to === 'initial_contact') day.followupCombined++;
    });
    days.forEach((d) => {
      d.calls = d.voicemail + d.dead_declined + d.followupCombined;
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
    const monthLabels: Array<string | null> = [];
    for (let w = 0; w < weeksToToday; w++) {
      const cells = [];
      let monthLabel: string | null = null;
      for (let d = 0; d < 7; d++) {
        const date = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + w * 7 + d);
        const iso = localIsoDate(date);
        if (date.getDate() === 1) monthLabel = date.toLocaleDateString('en-US', { month: 'short' });
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
      monthLabels.push(monthLabel);
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

    return { cols, monthLabels, max, activeDays, currentStreak, bestStreak, thisWeekActive, thisWeekTotal: dayOfWeek + 1 };
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
        <div className="flex shrink-0 items-center gap-2">
          {onOpenBriefing && (
            <button onClick={onOpenBriefing} className="btn shrink-0">
              <CalendarClock size={15} /> Today's Briefing
            </button>
          )}
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
              sub={`${stats.conversations} contacts of ${stats.calledLeadsCount} called`}
              color="#10b981"
            />
            <StatCard
              label="Conversion Rate"
              value={`${stats.conversionRate}%`}
              sub={`${stats.contracts} contracts of ${stats.calledLeadsCount} called`}
              color="#10b981"
            />
            <StatCard
              label="Voicemail Rate"
              value={`${stats.voicemailRate}%`}
              sub={`${stats.voicemailCount} of ${stats.calledLeadsCount} called`}
              color="#f59e0b"
            />
            <StatCard
              label="Dead / Declined Rate"
              value={`${stats.deadDeclinedRate}%`}
              sub={`${stats.deadDeclinedOutcomeCount} of ${stats.calledLeadsCount} called`}
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
            <StatCard
              label="Pickup Ratio"
              value={stats.pickupRatio ?? '—'}
              sub="calls per initial contact + follow-up + declined"
              color="#0ea5e9"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <GoalBar label="Daily Call Goal" done={stats.callsToday} goal={profile?.dailyGoal ?? 20} periodLabel="today" />
            <GoalBar
              label="Monthly Call Goal"
              done={stats.monthCalls}
              goal={profile?.monthlyGoal ?? 400}
              periodLabel={(() => {
                const n = new Date();
                const s = new Date(n.getFullYear(), n.getMonth(), 1);
                const e = new Date(n.getFullYear(), n.getMonth() + 1, 1);
                const fmt = (d: Date) => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
                return `${fmt(s)} – ${fmt(e)}`;
              })()}
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
            <Suspense fallback={<div className="flex h-[270px] items-center justify-center text-[13px] text-text-3">Loading chart…</div>}>
              <DailyActivityChart data={dailyTrend} />
            </Suspense>
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
            <div className="mb-4 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-success" />
              <h3 className="text-sm font-semibold text-text">Activity — {new Date().getFullYear()}</h3>
            </div>
            <div className="flex">
              <div className="mr-2 flex flex-col gap-[3px] pt-[17px] text-[10px] text-text-3">
                {WEEKDAY_LABELS.map((label, i) => (
                  <div key={i} className="flex h-3 items-center">
                    {label}
                  </div>
                ))}
              </div>
              <div>
                <div className="flex gap-[3px] pb-1">
                  {heatmap.monthLabels.map((label, wi) => (
                    <div key={wi} className="w-3 shrink-0 whitespace-nowrap text-[10px] text-text-3">
                      {label}
                    </div>
                  ))}
                </div>
                <div className="flex gap-[3px]">
                  {heatmap.cols.map((week, wi) => (
                    <div key={wi} className="flex flex-col gap-[3px]">
                      {week.map((cell) => (
                        <div key={cell.iso} className="group relative">
                          <div
                            className={`h-3 w-3 rounded-[3px] transition-transform group-hover:scale-125 ${cell.isToday ? 'ring-1 ring-primary ring-offset-1' : ''}`}
                            style={{ background: cell.isFuture ? 'transparent' : intensity(cell.count, heatmap.max) }}
                          />
                          {!cell.isFuture && (
                            <div className="pointer-events-none absolute top-[calc(100%+6px)] left-1/2 z-20 w-56 -translate-x-1/2 whitespace-nowrap rounded-lg border border-border bg-surface p-3 text-left opacity-0 shadow-popover transition-opacity group-hover:opacity-100">
                              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-text">
                                <MapPin size={12} className="shrink-0 text-primary" />
                                {formatFullDate(cell.iso)}
                              </div>
                              <div className="my-1.5 border-t border-border" />
                              <div className="flex items-center justify-between gap-4 text-[11px] text-text-2">
                                <span>Total Calls</span>
                                <span className="font-medium text-text">{cell.calls || '—'}</span>
                              </div>
                              <div className="flex items-center justify-between gap-4 text-[11px] text-text-2">
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
                <div className="mt-2.5 flex items-center justify-end gap-1 text-[10px] text-text-3">
                  <span>Less</span>
                  {[0, 1, 2, 3, 4, 5].map((lvl) => (
                    <span key={lvl} className="h-2.5 w-2.5 rounded-[2px]" style={{ background: intensity(lvl, 5) }} />
                  ))}
                  <span>More</span>
                </div>
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
  const todayIso = localIsoDate(new Date());
  const userId = session?.user.id ?? '';
  const isAdmin = profile?.role === 'admin';

  const [showBriefing, setShowBriefing] = useState(() => {
    if (!userId || isAdmin) return false;
    return !localStorage.getItem(`daily_briefing_${userId}_${todayIso}`);
  });

  function closeBriefing() {
    localStorage.setItem(`daily_briefing_${userId}_${todayIso}`, '1');
    setShowBriefing(false);
  }

  if (!session) return null;
  return (
    <>
      <DashboardView
        userId={userId}
        profile={profile}
        allowStartSession
        onOpenBriefing={!isAdmin ? () => setShowBriefing(true) : undefined}
      />
      {showBriefing && <DailyBriefingModal onClose={closeBriefing} />}
    </>
  );
}
