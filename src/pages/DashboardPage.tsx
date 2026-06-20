import { useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useLeads } from '@/hooks/useLeads';
import { useCallLog } from '@/hooks/useCallLog';
import { useTags } from '@/hooks/useTags';
import { useAuth } from '@/contexts/AuthContext';
import { SessionMode } from '@/components/session/SessionMode';
import { STATUS_CONFIG, type LeadStatus } from '@/types/domain';
import { localIsoDate } from '@/lib/utils';

const CONVERSATION_STATUSES: LeadStatus[] = ['followup', 'followup2', 'followup3'];

function BarRow({ label, count, max, color }: { label: string; count: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="w-28 shrink-0 truncate text-[12px] text-text-2">{label}</div>
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
      <div className="mt-1 font-display text-2xl font-semibold" style={{ color: color ?? '#eef0f5' }}>
        {value}
      </div>
      <div className="mt-0.5 text-[12px] text-text-3">{sub}</div>
    </div>
  );
}

function GoalBar({ label, done, goal, periodLabel }: { label: string; done: number; goal: number; periodLabel: string }) {
  const pct = Math.min(100, Math.round((done / goal) * 100));
  const isDone = done >= goal;
  const color = isDone ? '#22c97b' : pct >= 70 ? '#00cfb4' : pct >= 40 ? '#f5a524' : '#f05252';
  return (
    <div className="card !p-4">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">
          {label} <span className="text-text-3">· {periodLabel}</span>
        </div>
        <div className="font-mono text-[12px]" style={{ color }}>
          {isDone ? '🎉 Goal reached!' : `${pct}%`}
        </div>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="mt-1.5 font-mono text-[12px]" style={{ color }}>
        {done.toLocaleString()} / {goal.toLocaleString()}
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { data: leads = [] } = useLeads();
  const { data: callLog = [] } = useCallLog();
  const { data: tags = [] } = useTags();
  const { profile } = useAuth();

  const [sessionOpen, setSessionOpen] = useState(false);
  const [lcRange, setLcRange] = useState<7 | 30>(7);

  const stats = useMemo(() => {
    const total = leads.length;
    const called = leads.filter((l) => l.status !== 'new').length;
    const conversations = leads.filter((l) => CONVERSATION_STATUSES.includes(l.status)).length;
    const declined = leads.filter((l) => l.status === 'declined').length;
    const dead = leads.filter((l) => l.status === 'dead').length;
    const voicemail = leads.filter((l) => l.status === 'voicemail').length;
    const contactedLeads = conversations + declined;
    const contactRate = called > 0 ? Math.round((contactedLeads / called) * 100) : 0;
    const convRate = called > 0 ? Math.round((conversations / called) * 100) : 0;
    const vmRate = called > 0 ? Math.round((voicemail / called) * 100) : 0;
    const deadRate = called > 0 ? Math.round(((dead + declined) / called) * 100) : 0;
    const dialedPct = total > 0 ? Math.round((called / total) * 100) : 0;

    const todayIso = localIsoDate(new Date());
    const callsToday = callLog.filter((e) => localIsoDate(new Date(e.createdAt)) === todayIso).length;

    const now = new Date();
    const monthCalls = callLog.filter((e) => {
      const d = new Date(e.createdAt);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length;

    const dayOfWeek = now.getDay();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    const thisWeek = callLog.filter((e) => {
      const d = new Date(e.createdAt);
      return d >= weekStart && d <= weekEnd;
    });
    const weekCalled = thisWeek.length;
    const weekConversations = thisWeek.filter((e) => CONVERSATION_STATUSES.includes(e.status)).length;
    const weekVoicemail = thisWeek.filter((e) => e.status === 'voicemail').length;
    const weekDead = thisWeek.filter((e) => e.status === 'dead' || e.status === 'declined').length;

    const statusCounts: Record<string, number> = {};
    Object.keys(STATUS_CONFIG).forEach((k) => (statusCounts[k] = 0));
    leads.forEach((l) => (statusCounts[l.status] = (statusCounts[l.status] || 0) + 1));

    const ratingCounts = [1, 2, 3, 4, 5].map((s) => leads.filter((l) => l.rating === s).length);

    const tagCounts = tags
      .map((t) => ({ tag: t, count: leads.filter((l) => l.tagIds.includes(t.id)).length }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count);

    return {
      total,
      called,
      conversations,
      contactRate,
      convRate,
      vmRate,
      deadRate,
      dialedPct,
      callsToday,
      monthCalls,
      weekCalled,
      weekConversations,
      weekVoicemail,
      weekDead,
      weekLabel: `${weekStart.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString([], { month: 'short', day: 'numeric' })}`,
      statusCounts,
      ratingCounts,
      tagCounts,
    };
  }, [leads, callLog, tags]);

  const dailyTrend = useMemo(() => {
    const days: Array<{ iso: string; label: string; total: number; followup: number; voicemail: number; dead: number; onhold: number }> = [];
    const today = new Date();
    for (let i = lcRange - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const iso = localIsoDate(d);
      days.push({
        iso,
        label: d.toLocaleDateString([], lcRange <= 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' }),
        total: 0,
        followup: 0,
        voicemail: 0,
        dead: 0,
        onhold: 0,
      });
    }
    const byIso = new Map(days.map((d) => [d.iso, d]));
    callLog.forEach((entry) => {
      const iso = localIsoDate(new Date(entry.createdAt));
      const day = byIso.get(iso);
      if (!day) return;
      day.total++;
      if (CONVERSATION_STATUSES.includes(entry.status)) day.followup++;
      else if (entry.status === 'voicemail') day.voicemail++;
      else if (entry.status === 'dead' || entry.status === 'declined') day.dead++;
      else if (entry.status === 'onhold') day.onhold++;
    });
    return days;
  }, [callLog, lcRange]);

  const heatmap = useMemo(() => {
    const callsByDay = new Map<string, number>();
    callLog.forEach((e) => {
      const iso = localIsoDate(new Date(e.createdAt));
      callsByDay.set(iso, (callsByDay.get(iso) || 0) + 1);
    });
    const today = new Date();
    const jan1 = new Date(today.getFullYear(), 0, 1);
    const startDate = new Date(jan1.getFullYear(), jan1.getMonth(), jan1.getDate() - jan1.getDay());
    const weeksToToday = Math.ceil((today.getTime() - startDate.getTime()) / (7 * 86400000)) + 1;
    const maxCalls = Math.max(1, ...Array.from(callsByDay.values()));
    const todayTime = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

    const cols: Array<Array<{ iso: string; calls: number; isFuture: boolean; isToday: boolean }>> = [];
    for (let w = 0; w < weeksToToday; w++) {
      const cells = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + w * 7 + d);
        const iso = localIsoDate(date);
        const isFuture = date.getTime() > todayTime;
        cells.push({ iso, calls: callsByDay.get(iso) || 0, isFuture, isToday: date.getTime() === todayTime });
      }
      cols.push(cells);
    }
    return { cols, maxCalls };
  }, [callLog]);

  const maxStatus = Math.max(...Object.values(stats.statusCounts), 1);
  const maxRating = Math.max(...stats.ratingCounts, 1);
  const maxTag = Math.max(...stats.tagCounts.map((x) => x.count), 1);

  function intensity(calls: number, max: number) {
    if (calls === 0) return 'rgba(255,255,255,0.05)';
    const level = Math.min(5, Math.max(1, Math.ceil((calls / max) * 5)));
    const alpha = 0.15 + level * 0.17;
    return `rgba(0,207,180,${alpha.toFixed(2)})`;
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-text">Dashboard</h1>
          <p className="text-sm text-text-3">Your calling stats at a glance</p>
        </div>
        <button className="btn btn-primary" onClick={() => setSessionOpen(true)} disabled={leads.length === 0}>
          <Play size={14} /> Start Session
        </button>
      </div>

      {leads.length === 0 ? (
        <div className="card text-center text-text-3">Add some leads to see stats here.</div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Total Leads" value={stats.total} sub={`${stats.dialedPct}% dialed`} />
            <StatCard label="Calls Made" value={stats.called} sub={`out of ${stats.total} leads`} color="#2ddfc8" />
            <StatCard label="Conversations" value={stats.conversations} sub="initial + follow-ups" color="#b08afa" />
            <StatCard label="Contact Rate" value={`${stats.contactRate}%`} sub={`${stats.conversations} of ${stats.called} dialed`} color="#22c97b" />
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Conversion Rate" value={`${stats.convRate}%`} sub="conversations / calls" color="#22c97b" />
            <StatCard label="Voicemail Rate" value={`${stats.vmRate}%`} sub="voicemails left" color="#f5a524" />
            <StatCard label="Dead / Declined" value={`${stats.deadRate}%`} sub="not interested" color="#f05252" />
            <StatCard label="Calls Today" value={stats.callsToday} sub="logged today" color="#2ddfc8" />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <GoalBar label="Daily Goal" done={stats.callsToday} goal={profile?.dailyGoal ?? 150} periodLabel="today" />
            <GoalBar
              label="Monthly Goal"
              done={stats.monthCalls}
              goal={profile?.monthlyGoal ?? 3000}
              periodLabel={new Date().toLocaleDateString([], { month: 'long', year: 'numeric' })}
            />
          </div>

          <div className="card flex flex-wrap items-center justify-between gap-3 !py-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">This Week</div>
              <div className="font-mono text-[12px] text-text-2">{stats.weekLabel}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-blue-dim px-2.5 py-1 font-mono text-[11px] font-semibold text-blue-bright">📞 {stats.weekCalled} called</span>
              <span className="rounded-full bg-purple-dim px-2.5 py-1 font-mono text-[11px] font-semibold text-purple">💬 {stats.weekConversations} conversations</span>
              <span className="rounded-full bg-amber-dim px-2.5 py-1 font-mono text-[11px] font-semibold text-amber">📬 {stats.weekVoicemail} voicemail</span>
              <span className="rounded-full bg-red-dim px-2.5 py-1 font-mono text-[11px] font-semibold text-red">✗ {stats.weekDead} dead</span>
            </div>
          </div>

          <div className="card">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold text-text">Daily Call Activity</h3>
              <div className="flex gap-1">
                {([7, 30] as const).map((r) => (
                  <button key={r} onClick={() => setLcRange(r)} className={`btn !px-2.5 !py-1 text-[12px] ${lcRange === r ? '!border-blue !text-blue-bright' : ''}`}>
                    {r}D
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={dailyTrend}>
                <defs>
                  <linearGradient id="gTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2ddfc8" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#2ddfc8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="label" stroke="#454d5e" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#454d5e" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
                <Tooltip contentStyle={{ background: '#191d29', border: '1px solid #2a3042', borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="total" name="Total Calls" stroke="#2ddfc8" fill="url(#gTotal)" strokeWidth={2} />
                <Area type="monotone" dataKey="followup" name="Follow-Up" stroke="#22c97b" fill="transparent" strokeWidth={1.5} />
                <Area type="monotone" dataKey="voicemail" name="Voicemail" stroke="#f5a524" fill="transparent" strokeWidth={1.5} />
                <Area type="monotone" dataKey="dead" name="Dead/Declined" stroke="#f05252" fill="transparent" strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="card">
              <h3 className="mb-2 font-display text-sm font-semibold text-text">Status Breakdown</h3>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                <BarRow key={k} label={v.label} count={stats.statusCounts[k]} max={maxStatus} color={v.color} />
              ))}
            </div>
            <div className="card">
              <h3 className="mb-2 font-display text-sm font-semibold text-text">Rating Breakdown</h3>
              {[5, 4, 3, 2, 1].map((s) => (
                <BarRow key={s} label={'★'.repeat(s) + '☆'.repeat(5 - s)} count={stats.ratingCounts[s - 1]} max={maxRating} color="#f5a524" />
              ))}
            </div>
            <div className="card">
              <h3 className="mb-2 font-display text-sm font-semibold text-text">Tag Breakdown</h3>
              {stats.tagCounts.length === 0 && <div className="text-[13px] text-text-3">No tagged leads yet.</div>}
              {stats.tagCounts.map(({ tag, count }) => (
                <BarRow key={tag.id} label={tag.name} count={count} max={maxTag} color={tag.colorText} />
              ))}
            </div>
          </div>

          <div className="card overflow-x-auto">
            <h3 className="mb-3 font-display text-sm font-semibold text-text">Call Activity — {new Date().getFullYear()}</h3>
            <div className="flex gap-[3px]">
              {heatmap.cols.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-[3px]">
                  {week.map((cell) => (
                    <div
                      key={cell.iso}
                      title={`${cell.iso}: ${cell.calls} call${cell.calls !== 1 ? 's' : ''}`}
                      className={`h-[11px] w-[11px] rounded-[2px] ${cell.isToday ? 'ring-1 ring-blue-bright' : ''}`}
                      style={{ background: cell.isFuture ? 'transparent' : intensity(cell.calls, heatmap.maxCalls) }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {sessionOpen && <SessionMode leads={leads} onClose={() => setSessionOpen(false)} />}
    </div>
  );
}
