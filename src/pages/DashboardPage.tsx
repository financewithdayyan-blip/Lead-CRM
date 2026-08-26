import { lazy, Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Bot,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  DollarSign,
  FileSignature,
  Flame,
  Gauge,
  Hash,
  Medal,
  Megaphone,
  MessageSquare,
  Phone,
  PhoneCall,
  PhoneIncoming,
  Reply,
  Sparkles,
  Tags as TagsIcon,
  Target,
  Timer,
  TrendingUp,
  Trophy,
  UserX,
  Users,
  Voicemail,
  Waypoints,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useLeads } from '@/hooks/useLeads';
import { useActivityFeed } from '@/hooks/useActivities';
import { useTags } from '@/hooks/useTags';
import { useSendLog, useInboundMessages, useSmsDeliveryLog } from '@/hooks/useSmsStats';
import { useAuth } from '@/contexts/AuthContext';
import { STAGE_CONFIG, STAGE_ORDER, type LeadStage, type Profile } from '@/types/domain';
import { formatPhone, localIsoDate } from '@/lib/utils';
import { ScheduledCallsCard } from '@/components/dashboard/ScheduledCallsCard';
import { TasksCard } from '@/components/dashboard/TasksCard';
import { RANGE_OPTIONS, rangeCutoff, type DateRange } from '@/lib/dateRange';
import { CardHeader, SectionLabel } from '@/components/ui/CardHeader';
import { RadialGauge } from '@/components/ui/RadialGauge';
import { useTeamMembers } from '@/hooks/useTeam';
import { useMarketingSpend } from '@/hooks/useMarketingSpend';
import { useOrgLeads, useOrgActivities, computeRepLeaderboard, computeDealVelocity } from '@/hooks/useSalesKpis';

const PipelineActivityChart = lazy(() =>
  import('@/components/dashboard/PipelineActivityChart').then((m) => ({ default: m.PipelineActivityChart })),
);
const SmsPerformanceChart = lazy(() =>
  import('@/components/dashboard/SmsPerformanceChart').then((m) => ({ default: m.SmsPerformanceChart })),
);
const PipelineFunnel = lazy(() =>
  import('@/components/dashboard/PipelineFunnel').then((m) => ({ default: m.PipelineFunnel })),
);
const CallProgressChart = lazy(() =>
  import('@/components/dashboard/CallProgressChart').then((m) => ({ default: m.CallProgressChart })),
);

// A lead currently sitting in one of these stages has, by definition, been
// qualified — either the AI got there via the framework, or a human moved it
// by hand. Calling is meant to happen only downstream of this line now.
const QUALIFIED_PLUS_STAGES: LeadStage[] = ['initial_contact', 'followup', 'negotiation', 'contract'];

// The main flow, in order. Every other stage (voicemail, dead_declined,
// onhold, others) is an exit from this flow rather than a step within it —
// see the off-funnel chips rendered alongside the funnel itself.
// Starts at Contacted, not Cold — a "Cold" bar scaled against the whole
// (mostly never-contacted) lead universe dwarfs every real funnel stage down
// to the same minimum-width floor. Total/cold counts are shown as separate
// context above the funnel instead of distorting its scale.
const FUNNEL_ORDER = ['contacted', 'replied', 'partial_qualified', 'qualified', 'negotiation', 'contract'] as const;
type FunnelKey = (typeof FUNNEL_ORDER)[number];
const FUNNEL_LABELS: Record<FunnelKey, string> = {
  contacted: 'Contacted',
  replied: 'Replied',
  partial_qualified: 'Partial Qualified',
  qualified: 'Qualified',
  negotiation: 'Negotiation',
  contract: 'Contract',
};
// Matches STAGE_CONFIG's own colors for initial_contact/followup exactly,
// rather than reusing one color for both now that they're separate bars.
const FUNNEL_COLORS: Record<FunnelKey, string> = {
  contacted: '#5B9BD5',
  replied: '#0891b2',
  partial_qualified: '#a78bfa',
  qualified: '#c084fc',
  negotiation: '#fb923c',
  contract: '#10b981',
};

function funnelBucket(stage: LeadStage): FunnelKey | null {
  if (stage === 'contacted') return 'contacted';
  if (stage === 'replied') return 'replied';
  if (stage === 'initial_contact') return 'partial_qualified';
  if (stage === 'followup') return 'qualified';
  if (stage === 'negotiation') return 'negotiation';
  // In Title / Closed are downstream of Contract — no separate bars for them
  // here, but a lead that's moved past Contract still needs to keep counting
  // toward "reached Contract or further," not fall out of the funnel.
  if (stage === 'contract' || stage === 'in_title' || stage === 'closed') return 'contract';
  return null;
}

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

function StatCard({
  label,
  value,
  sub,
  color,
  icon: Icon,
  hero,
}: {
  label: string;
  value: string | number;
  sub: string;
  color?: string;
  icon?: LucideIcon;
  /** Solid-color block instead of a white card with a tinted icon — for the
   * 3-4 headline numbers on the page, matching the bold hero-tile pattern
   * real dashboard products use instead of treating every KPI equally. */
  hero?: boolean;
}) {
  const c = color ?? '#0B1E33';
  if (hero) {
    return (
      <div
        className="rounded-lg p-4 shadow-card transition-transform hover:-translate-y-0.5 hover:shadow-card-hover"
        style={{ background: c }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-white/70">{label}</div>
          {Icon && (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/15 text-white">
              <Icon size={14} />
            </span>
          )}
        </div>
        <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-white">{value}</div>
        <div className="mt-0.5 text-[12px] text-white/75">{sub}</div>
      </div>
    );
  }
  return (
    <div className="card !p-4 transition-transform hover:-translate-y-0.5 hover:shadow-card-hover">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">{label}</div>
        {Icon && (
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
            style={{ background: `${c}17`, color: c }}
          >
            <Icon size={14} />
          </span>
        )}
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold tabular-nums" style={{ color: c }}>
        {value}
      </div>
      <div className="mt-0.5 text-[12px] text-text-3">{sub}</div>
    </div>
  );
}

function GoalBar({ label, done, goal, periodLabel }: { label: string; done: number; goal: number; periodLabel: string }) {
  const pct = Math.min(100, Math.round((done / goal) * 100));
  const isDone = done >= goal;
  const color = isDone ? '#10b981' : pct >= 70 ? '#1568A8' : pct >= 40 ? '#f59e0b' : '#ef4444';
  return (
    <div className="card !p-4">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">
          {label} <span className="text-text-3">· {periodLabel}</span>
        </div>
        <div className="font-mono text-[12px] font-semibold tabular-nums" style={{ color }}>
          {isDone ? 'Goal reached' : `${pct}%`}
        </div>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="mt-1.5 font-mono text-[12px] tabular-nums text-text-2">
        {done.toLocaleString()} / {goal.toLocaleString()}
      </div>
    </div>
  );
}


export function DashboardView({
  userId,
  profile,
  heading = 'Dashboard',
  subtitle = 'Your pipeline, from first text to closed contract',
  allowStartSession = false,
  showSmsStats = false,
}: {
  userId: string;
  profile: Profile | null;
  heading?: string;
  subtitle?: string;
  allowStartSession?: boolean;
  /** SMS outreach is an admin-only feature (RLS enforces this server-side
   * too — a caller's send_log/inbound_messages query just comes back empty),
   * and it's account-wide rather than per-caller, so the unified pipeline
   * view only ever renders on the admin's own "/" dashboard, never on a team
   * member's individual dashboard. */
  showSmsStats?: boolean;
}) {
  const { data: leads = [] } = useLeads(userId);
  const { data: activities = [] } = useActivityFeed(userId);
  const { data: tags = [] } = useTags(userId);
  const { data: sendLog = [] } = useSendLog(showSmsStats);
  const { data: inboundMessages = [] } = useInboundMessages(showSmsStats);
  const { data: smsDeliveryLog = [] } = useSmsDeliveryLog(showSmsStats);
  const { data: teamMembers = [] } = useTeamMembers();
  const { data: marketingSpend = [] } = useMarketingSpend();
  const { data: orgLeads = [] } = useOrgLeads(showSmsStats);
  const { data: orgActivities = [] } = useOrgActivities(showSmsStats);

  // One control drives the whole page — every range-scoped card and the
  // trend chart below all read off this same cutoff, so nothing on screen
  // can silently disagree about what "recent" means.
  const [dateRange, setDateRange] = useState<DateRange>('30d');
  const cutoff = useMemo(() => rangeCutoff(dateRange), [dateRange]);
  const inRange = (iso: string) => !cutoff || new Date(iso) >= cutoff;

  const calls = useMemo(() => activities.filter((a) => a.type === 'call'), [activities]);

  // Snapshot — which leads are, right now, past the qualification gate. Used
  // both for the funnel and to check calling activity against the rule that
  // calls should only go to already-qualified leads.
  const qualifiedPlusIds = useMemo(
    () => new Set(leads.filter((l) => QUALIFIED_PLUS_STAGES.includes(l.stage)).map((l) => l.id)),
    [leads],
  );

  const funnel = useMemo(() => {
    // Live headcount, cumulative by current stage — "Replied" counts every
    // lead currently sitting at Replied or any later active stage, matching
    // what the Kanban board shows right now. A lead that reached a stage and
    // then went Dead/Declined, On Hold, or Other no longer counts anywhere
    // here — that population is already broken out in the off-pipeline chips
    // below instead of being folded back into these bars.
    const activeBuckets = leads
      .map((l) => {
        const bucket = funnelBucket(l.stage);
        return bucket ? FUNNEL_ORDER.indexOf(bucket) : -1;
      })
      .filter((idx) => idx >= 0);
    const stages = FUNNEL_ORDER.map((key, idx) => ({
      key,
      label: FUNNEL_LABELS[key],
      color: FUNNEL_COLORS[key],
      count: activeBuckets.filter((b) => b >= idx).length,
    }));
    const offFunnel = [
      { label: 'Dead / Declined', count: leads.filter((l) => l.stage === 'dead_declined').length, color: '#ef4444' },
      { label: 'On Hold', count: leads.filter((l) => l.stage === 'onhold').length, color: '#2dd4bf' },
      { label: 'Others', count: leads.filter((l) => l.stage === 'others').length, color: '#94a3b8' },
      { label: 'Voicemail (legacy)', count: leads.filter((l) => l.stage === 'voicemail').length, color: '#f59e0b' },
    ].filter((o) => o.count > 0);
    return {
      stages,
      offFunnel,
      totalLeads: leads.length,
      coldCount: leads.filter((l) => l.stage === 'new').length,
    };
  }, [leads]);

  // ── Sales: funnel efficiency (contact/qualify/close rate) ─────────────────
  // Real data, no new fetch — reuses the same cumulative funnel counts
  // already computed above for the Pipeline card, just expressed as
  // stage-to-stage percentages instead of a bar chart.
  const funnelEfficiency = useMemo(() => {
    const contactedOrBeyond = funnel.stages[0]?.count ?? 0;
    const qualifiedOrBeyond = funnel.stages[3]?.count ?? 0;
    const contractOrBeyond = funnel.stages[5]?.count ?? 0;
    return {
      contactRate: funnel.totalLeads > 0 ? (contactedOrBeyond / funnel.totalLeads) * 100 : 0,
      qualifyRate: contactedOrBeyond > 0 ? (qualifiedOrBeyond / contactedOrBeyond) * 100 : 0,
      closeRate: qualifiedOrBeyond > 0 ? (contractOrBeyond / qualifiedOrBeyond) * 100 : 0,
    };
  }, [funnel]);

  // ── Sales: per-rep performance (real, needs >0 org-wide activity data) ────
  const repLeaderboard = useMemo(
    () =>
      computeRepLeaderboard(
        orgLeads,
        orgActivities,
        teamMembers.map((m) => ({ memberId: m.memberId, name: m.member.fullName || m.member.email })),
      ),
    [orgLeads, orgActivities, teamMembers],
  );

  // ── Sales: deal velocity (avg days between real milestones) ───────────────
  const dealVelocity = useMemo(() => computeDealVelocity(orgLeads, orgActivities), [orgLeads, orgActivities]);

  // ── Marketing: lead volume by week (are we feeding the pipeline enough) ───
  const leadVolumeTrend = useMemo(() => {
    const weekMap = new Map<string, number>();
    for (const l of leads) {
      const d = new Date(l.createdAt);
      const weekStart = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
      const key = localIsoDate(weekStart);
      weekMap.set(key, (weekMap.get(key) ?? 0) + 1);
    }
    return Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([iso, count]) => ({ label: new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), count }));
  }, [leads]);

  // ── Marketing: spend logged + how much of the lead base is source-tagged —
  // deliberately NOT a $/lead or $/deal ratio. $444 logged (mostly software
  // costs, not ad spend) against thousands of leads would produce a
  // technically-real but practically meaningless number. Shown as plain
  // totals until there's enough real, representative spend data to divide.
  const marketingSnapshot = useMemo(() => {
    const totalSpend = marketingSpend.reduce((sum, s) => sum + Number(s.amount), 0);
    const tagged = leads.filter((l) => l.source && l.source.trim()).length;
    return { totalSpend, tagged, total: leads.length, taggedPct: leads.length > 0 ? (tagged / leads.length) * 100 : 0 };
  }, [marketingSpend, leads]);

  const stats = useMemo(() => {
    const total = leads.length;
    const contactedOrBeyond = leads.filter((l) => l.stage !== 'new').length;
    const qualified = qualifiedPlusIds.size;
    const contracts = leads.filter((l) => l.stage === 'contract').length;
    const optedOut = leads.filter((l) => l.optedOut).length;
    const inConversation = leads.filter((l) => l.stage === 'replied').length;

    const qualifiedRate = contactedOrBeyond > 0 ? Math.round((qualified / contactedOrBeyond) * 100) : 0;
    const contractRate = qualified > 0 ? Math.round((contracts / qualified) * 100) : 0;
    const optOutRate = contactedOrBeyond > 0 ? Math.round((optedOut / contactedOrBeyond) * 100) : 0;

    // ── Range-scoped activity ────────────────────────────────────────────
    const callsInRange = calls.filter((a) => inRange(a.createdAt));
    const sendLogInRange = sendLog.filter((r) => inRange(r.createdAt));
    const repliesInRange = inboundMessages.filter((m) => !m.isReaction && inRange(m.receivedAt));
    const repliedLeadIdsInRange = new Set(repliesInRange.filter((m) => m.leadId).map((m) => m.leadId));
    const responseRate =
      sendLogInRange.length > 0 ? Math.round((repliedLeadIdsInRange.size / sendLogInRange.length) * 100) : 0;
    const photosReceived = repliesInRange.filter((m) => m.hasAttachments).length;

    // The rule is calling happens only to already-qualified leads — this
    // both reports the intended metric and flags when reality drifts from
    // it, rather than assuming the rule is always followed.
    const callsToQualified = callsInRange.filter((a) => qualifiedPlusIds.has(a.leadId)).length;
    const callsOffProcess = callsInRange.length - callsToQualified;

    const smsActivitiesInRange = activities.filter((a) => a.type === 'sms' && inRange(a.createdAt));
    const aiRepliesSent = smsActivitiesInRange.filter((a) => {
      const meta = a.meta as { direction?: string; aiGenerated?: boolean };
      return meta?.direction === 'outbound' && meta?.aiGenerated;
    }).length;

    const sentToday = sendLog.filter((r) => localIsoDate(new Date(r.createdAt)) === localIsoDate(new Date())).length;

    const byNumber = new Map<string, number>();
    sendLogInRange.forEach((r) => byNumber.set(r.sentFrom, (byNumber.get(r.sentFrom) ?? 0) + 1));
    const numberCounts = Array.from(byNumber.entries())
      .map(([phone, count]) => ({ phone, label: formatPhone(phone), count }))
      .sort((a, b) => b.count - a.count);

    // ── Closing efficiency (calling-quality detail, all-time so the ratios
    // stay meaningful against the all-time contract count) ────────────────
    const callsToQualifiedAllTime = calls.filter((a) => qualifiedPlusIds.has(a.leadId)).length;
    const callsPerContract = contracts > 0 ? (callsToQualifiedAllTime / contracts).toFixed(1) : null;
    const outcomeCount = (key: string) => calls.filter((a) => (a.meta as { outcome?: string })?.outcome === key).length;
    const declinedCount = outcomeCount('declined');
    // 'followup' hasn't been a selectable call outcome since the session
    // dropped it in favor of a dedicated Follow-Up session, but old calls
    // logged before that change still carry it — keep counting it here so
    // the ratio doesn't silently shift for historical data.
    const pickupDenominator = outcomeCount('initial_contact') + outcomeCount('followup') + declinedCount;
    const pickupRatio = pickupDenominator > 0 ? (calls.length / pickupDenominator).toFixed(1) : null;

    // Caller-facing outcome ratios — share of all calls that landed on each
    // outcome, all-time (this view has no date-range picker to scope against).
    const voicemailRate = calls.length > 0 ? Math.round((outcomeCount('voicemail') / calls.length) * 100) : 0;
    const deadRate = calls.length > 0 ? Math.round(((outcomeCount('dead') + declinedCount) / calls.length) * 100) : 0;
    const qualifyingRate = calls.length > 0 ? Math.round((outcomeCount('initial_contact') / calls.length) * 100) : 0;

    const todayIso = localIsoDate(new Date());
    const callsToday = calls.filter((a) => localIsoDate(new Date(a.createdAt)) === todayIso).length;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const monthCalls = calls.filter((a) => {
      const d = new Date(a.createdAt);
      return d >= monthStart && d < nextMonthStart;
    }).length;

    const callTimes = calls.map((a) => new Date(a.createdAt).getTime()).sort((a, b) => a - b);
    let totalSessions = 0;
    let lastTime: number | null = null;
    for (const t of callTimes) {
      if (lastTime === null || t - lastTime > 20 * 60 * 1000) totalSessions++;
      lastTime = t;
    }

    const stageCounts: Record<string, number> = {};
    STAGE_ORDER.forEach((s) => (stageCounts[s] = 0));
    leads.forEach((l) => (stageCounts[l.stage] = (stageCounts[l.stage] || 0) + 1));

    const tagCounts = tags
      .map((t) => ({ tag: t, count: leads.filter((l) => l.tagIds.includes(t.id)).length }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count);

    return {
      total,
      qualified,
      qualifiedRate,
      contracts,
      contractRate,
      optedOut,
      optOutRate,
      inConversation,
      sentInRange: sendLogInRange.length,
      sentToday,
      repliesInRange: repliesInRange.length,
      repliedLeadCount: repliedLeadIdsInRange.size,
      responseRate,
      photosReceived,
      callsToQualified,
      callsOffProcess,
      aiRepliesSent,
      numberCounts,
      callsPerContract,
      pickupRatio,
      voicemailRate,
      deadRate,
      qualifyingRate,
      callsToday,
      monthCalls,
      totalSessions,
      stageCounts,
      tagCounts,
    };
  }, [leads, calls, tags, activities, sendLog, inboundMessages, qualifiedPlusIds, cutoff]);

  // Chart granularity follows the same global range rather than a second,
  // independent control — Today and 7D both read as a 7-day chart since a
  // single-day trend isn't a trend, and 90D/All cap at 90 days of buckets.
  const trendDayCount = dateRange === '30d' ? 30 : dateRange === '90d' || dateRange === 'all' ? 90 : 7;

  const activityTrend = useMemo(() => {
    const days: Array<{ iso: string; label: string; sent: number; replies: number; qualified: number; calls: number }> = [];
    const today = new Date();
    for (let i = trendDayCount - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const iso = localIsoDate(d);
      days.push({
        iso,
        label: d.toLocaleDateString([], trendDayCount <= 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' }),
        sent: 0,
        replies: 0,
        qualified: 0,
        calls: 0,
      });
    }
    const byIso = new Map(days.map((d) => [d.iso, d]));
    sendLog.forEach((r) => {
      const day = byIso.get(localIsoDate(new Date(r.createdAt)));
      if (day) day.sent++;
    });
    inboundMessages.forEach((m) => {
      if (m.isReaction) return;
      const day = byIso.get(localIsoDate(new Date(m.receivedAt)));
      if (day) day.replies++;
    });
    leads.forEach((l) => {
      if (!l.qualifiedAt) return;
      const day = byIso.get(localIsoDate(new Date(l.qualifiedAt)));
      if (day) day.qualified++;
    });
    calls.forEach((a) => {
      if (!qualifiedPlusIds.has(a.leadId)) return;
      const day = byIso.get(localIsoDate(new Date(a.createdAt)));
      if (day) day.calls++;
    });
    return days;
  }, [sendLog, inboundMessages, leads, calls, qualifiedPlusIds, trendDayCount]);

  // Delivery rate = delivered / sent, reply rate = replies / delivered —
  // Zoom's own definitions (confirmed against a real Zoom report: 108
  // delivered of 264 sent, 8 replies, "reply rate 7.41%" = 8/108, not 8/264).
  // smsDeliveryLog only covers the sync job's lookback window, so a day with
  // no synced data renders as a gap (null) rather than a misleading 0%.
  const smsPerformanceTrend = useMemo(() => {
    const days: Array<{ iso: string; label: string; sent: number; delivered: number; replies: number }> = [];
    const today = new Date();
    for (let i = trendDayCount - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      days.push({ iso: localIsoDate(d), label: d.toLocaleDateString([], trendDayCount <= 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' }), sent: 0, delivered: 0, replies: 0 });
    }
    const byIso = new Map(days.map((d) => [d.iso, d]));
    smsDeliveryLog.forEach((r) => {
      const day = byIso.get(localIsoDate(new Date(r.occurredAt)));
      if (!day) return;
      if (r.direction === 'Out') {
        day.sent++;
        if (r.deliveryStatus === 'delivered') day.delivered++;
      } else {
        day.replies++;
      }
    });
    return days.map((d) => ({
      iso: d.iso,
      label: d.label,
      sent: d.sent,
      delivered: d.delivered,
      replies: d.replies,
      deliveryRate: d.sent > 0 ? (d.delivered / d.sent) * 100 : null,
      replyRate: d.delivered > 0 ? (d.replies / d.delivered) * 100 : null,
    }));
  }, [smsDeliveryLog, trendDayCount]);

  // Caller-facing counterpart to activityTrend — driven by call outcomes
  // instead of SMS activity, since callers never see SMS data at all.
  const callsTrend = useMemo(() => {
    const days: Array<{ iso: string; label: string; totalCalls: number; voicemails: number; dead: number; qualified: number }> = [];
    const today = new Date();
    for (let i = trendDayCount - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const iso = localIsoDate(d);
      days.push({
        iso,
        label: d.toLocaleDateString([], trendDayCount <= 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' }),
        totalCalls: 0,
        voicemails: 0,
        dead: 0,
        qualified: 0,
      });
    }
    const byIso = new Map(days.map((d) => [d.iso, d]));
    calls.forEach((a) => {
      const day = byIso.get(localIsoDate(new Date(a.createdAt)));
      if (!day) return;
      day.totalCalls++;
      const callOutcome = (a.meta as { outcome?: string })?.outcome;
      if (callOutcome === 'voicemail') day.voicemails++;
      else if (callOutcome === 'dead' || callOutcome === 'declined') day.dead++;
      else if (callOutcome === 'initial_contact') day.qualified++;
    });
    return days;
  }, [calls, trendDayCount]);

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
  const maxTag = Math.max(...stats.tagCounts.map((x) => x.count), 1);
  const maxNumber = Math.max(...stats.numberCounts.map((x) => x.count), 1);

  const rangeLabel = RANGE_OPTIONS.find((r) => r.key === dateRange)?.label ?? '';
  const followupLeadsCount = leads.filter((l) => l.stage === 'followup').length;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-text">{heading}</h1>
          <p className="text-sm text-text-3">{subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {showSmsStats && (
            <div className="flex gap-1 rounded-lg border border-border-2 bg-surface-3 p-0.5">
              {RANGE_OPTIONS.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setDateRange(r.key)}
                  className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                    dateRange === r.key ? 'bg-surface text-text shadow-sm' : 'text-text-3 hover:text-text-2'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}
          {allowStartSession ? (
            <>
              {followupLeadsCount > 0 && (
                <Link to="/session?mode=followup" className="btn shrink-0">
                  <CalendarClock size={15} /> Start Follow-Up Session ({followupLeadsCount})
                </Link>
              )}
              <Link to="/session" className="btn btn-primary shrink-0">
                <PhoneCall size={15} /> Start Session
              </Link>
            </>
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
        <div className="space-y-6">
          <div>
            <SectionLabel>Overview</SectionLabel>
            {showSmsStats ? (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatCard
                    label="Total Leads"
                    value={stats.total.toLocaleString()}
                    sub={`${leads.filter((l) => l.stage === 'new').length} still cold`}
                    color="#0B1E33"
                    icon={Users}
                    hero
                  />
                  <StatCard
                    label="Qualified Leads"
                    value={stats.qualified.toLocaleString()}
                    sub={`${stats.qualifiedRate}% of contacted`}
                    color="#1568A8"
                    icon={CheckCircle2}
                    hero
                  />
                  <StatCard
                    label="Contracts"
                    value={stats.contracts.toLocaleString()}
                    sub={`${stats.contractRate}% of qualified leads`}
                    color="#10b981"
                    icon={FileSignature}
                    hero
                  />
                  <StatCard
                    label="SMS Sent"
                    value={stats.sentInRange.toLocaleString()}
                    sub={`${rangeLabel.toLowerCase()} · ${stats.sentToday} today`}
                    color="#C9A24B"
                    icon={MessageSquare}
                    hero
                  />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatCard
                    label="Replies"
                    value={stats.repliesInRange.toLocaleString()}
                    sub={`${stats.responseRate}% response rate`}
                    color="#22d3ee"
                    icon={Reply}
                  />
                  <StatCard
                    label="AI Auto-Replies"
                    value={stats.aiRepliesSent.toLocaleString()}
                    sub="drafted and sent, no human touch"
                    color="#a78bfa"
                    icon={Bot}
                  />
                  <StatCard
                    label="Calls to Qualified Leads"
                    value={stats.callsToQualified.toLocaleString()}
                    sub={
                      stats.callsOffProcess > 0
                        ? `${stats.callsOffProcess} off-process this ${dateRange === 'today' ? 'day' : 'range'}`
                        : 'all on-process'
                    }
                    color={stats.callsOffProcess > 0 ? '#f59e0b' : '#fb923c'}
                    icon={PhoneCall}
                  />
                  <StatCard
                    label="Opted Out / DNC"
                    value={stats.optedOut.toLocaleString()}
                    sub={`${stats.optOutRate}% of contacted`}
                    color="#ef4444"
                    icon={UserX}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatCard label="Total Leads" value={stats.total} sub={`${stats.qualified} qualified`} color="#0B1E33" icon={Users} hero />
                  <StatCard
                    label="Qualified Leads"
                    value={stats.qualified}
                    sub={`${stats.qualifiedRate}% of contacted`}
                    color="#1568A8"
                    icon={CheckCircle2}
                    hero
                  />
                  <StatCard
                    label="Contracts"
                    value={stats.contracts}
                    sub={`${stats.contractRate}% of qualified`}
                    color="#10b981"
                    icon={FileSignature}
                    hero
                  />
                  <StatCard label="Calls Made" value={calls.length} sub={`out of ${stats.total} leads`} color="#C9A24B" icon={Phone} hero />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatCard label="Total Sessions" value={stats.totalSessions} sub="calling sessions run" color="#1568A8" icon={Activity} />
                  <StatCard label="Calls Today" value={stats.callsToday} sub="logged today" color="#1568A8" icon={CalendarCheck} />
                  <StatCard
                    label="Pickup Ratio"
                    value={stats.pickupRatio ?? '—'}
                    sub="calls per real outcome"
                    color="#0891b2"
                    icon={PhoneIncoming}
                  />
                  <StatCard
                    label="Qualifying Ratio"
                    value={`${stats.qualifyingRate}%`}
                    sub="of calls end Qualified"
                    color="#a78bfa"
                    icon={TrendingUp}
                  />
                  <StatCard
                    label="Voicemail Ratio"
                    value={`${stats.voicemailRate}%`}
                    sub="of calls end Voicemail"
                    color="#f59e0b"
                    icon={Voicemail}
                  />
                  <StatCard label="Dead Ratio" value={`${stats.deadRate}%`} sub="of calls end Dead/Declined" color="#ef4444" icon={XCircle} />
                  <StatCard
                    label="Opted Out / DNC"
                    value={stats.optedOut}
                    sub={`${stats.optOutRate}% of contacted`}
                    color="#ef4444"
                    icon={UserX}
                  />
                </div>
              </>
            )}
          </div>

          {showSmsStats && stats.callsOffProcess > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-dim px-3 py-2 text-[13px] text-warning">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <div>
                {stats.callsOffProcess} call{stats.callsOffProcess !== 1 ? 's were' : ' was'} logged against a lead
                that isn't currently Qualified or further along — calling is meant to happen only after SMS
                qualification now.
              </div>
            </div>
          )}

          {showSmsStats && (
            <div>
              <SectionLabel>Today</SectionLabel>
              <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
                <ScheduledCallsCard leads={leads} />
                <TasksCard userId={userId} leads={leads} />
              </div>
            </div>
          )}

          {!showSmsStats && (
            <div>
              <SectionLabel>Today</SectionLabel>
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
            </div>
          )}

          {showSmsStats && (
            <div>
              <SectionLabel>Sales Performance</SectionLabel>
              <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-3">
                <div className="card">
                  <CardHeader icon={Target} title="Sales Funnel Efficiency" sub="contact → qualify → close" />
                  <div className="mt-5 flex justify-between">
                    <RadialGauge pct={funnelEfficiency.contactRate} color="#1568A8" size={76} strokeWidth={7} label="Contact Rate" sub="of all leads" centered />
                    <RadialGauge pct={funnelEfficiency.qualifyRate} color="#a78bfa" size={76} strokeWidth={7} label="Qualify Rate" sub="of contacted" centered />
                    <RadialGauge pct={funnelEfficiency.closeRate} color="#10b981" size={76} strokeWidth={7} label="Close Rate" sub="of qualified" centered />
                  </div>
                </div>

                <div className="card">
                  <CardHeader icon={Timer} title="Deal Velocity" sub="avg. days between milestones, this year" tone="info" />
                  <div className="mt-3 space-y-2">
                    {dealVelocity.map((v) => (
                      <div key={v.toLabel} className="flex items-center justify-between rounded-md border border-border-2 bg-surface-3 px-3 py-2.5">
                        <div className="text-[12.5px] text-text-2">
                          {v.fromLabel} → {v.toLabel}
                        </div>
                        <div className="text-right">
                          <div className="font-mono text-[15px] font-semibold tabular-nums text-text">
                            {v.avgDays !== null ? `${v.avgDays.toFixed(1)}d` : '—'}
                          </div>
                          <div className="text-[10px] text-text-3">
                            {v.sampleSize} lead{v.sampleSize !== 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card">
                  <CardHeader icon={Medal} title="Rep Performance" sub="calls, qualify rate, contracts — this year" tone="warning" />
                  <div className="mt-3 space-y-1.5">
                    {repLeaderboard.length === 0 ? (
                      <div className="text-[13px] text-text-3">No activity logged yet this year.</div>
                    ) : (
                      repLeaderboard.map((r, i) => (
                        <div key={r.userId} className="flex items-center gap-2.5 rounded-md border border-border-2 bg-surface-3 px-3 py-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                            {i + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-medium text-text">{r.name}</div>
                            <div className="text-[11px] text-text-3">
                              {r.calls} calls · {r.qualifyRate}% qualify rate
                            </div>
                          </div>
                          <div className="font-mono text-[15px] font-semibold tabular-nums text-success">{r.contracts}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div>
            <SectionLabel>Performance</SectionLabel>
            <div className="space-y-3">
              {showSmsStats && (
                <div className="card chart-layer">
                  <CardHeader icon={Waypoints} title="Pipeline Activity" sub={`SMS sent, replies, newly qualified, and calls to qualified leads · ${rangeLabel}`} />
                  <Suspense fallback={<div className="flex h-[280px] items-center justify-center text-[13px] text-text-3">Loading chart…</div>}>
                    <div className="mt-3">
                      <PipelineActivityChart data={activityTrend} />
                    </div>
                  </Suspense>
                </div>
              )}

              {showSmsStats && (
                <div className="card chart-layer">
                  <CardHeader
                    icon={TrendingUp}
                    title="SMS Delivery & Reply Rate"
                    sub={`Real delivery status synced from Zoom · ${rangeLabel} · delivery rate = delivered/sent, reply rate = replies/delivered`}
                  />
                  <Suspense fallback={<div className="flex h-[280px] items-center justify-center text-[13px] text-text-3">Loading chart…</div>}>
                    <div className="mt-3">
                      <SmsPerformanceChart data={smsPerformanceTrend} />
                    </div>
                  </Suspense>
                </div>
              )}

              {!showSmsStats && (
                <div className="card">
                  <CardHeader icon={Waypoints} title="Calling Progress" sub={`Total calls, voicemails, dead, and qualified · last ${trendDayCount} days`} />
                  <Suspense fallback={<div className="flex h-[280px] items-center justify-center text-[13px] text-text-3">Loading chart…</div>}>
                    <div className="mt-3">
                      <CallProgressChart data={callsTrend} />
                    </div>
                  </Suspense>
                </div>
              )}

            </div>
          </div>

          <div>
            <SectionLabel>Pipeline</SectionLabel>
            <div className="space-y-3">
              {showSmsStats && (
                <div className="card chart-layer">
                  <CardHeader icon={Gauge} title="Pipeline" sub="live headcount — matches the Kanban board" />
                  <Suspense fallback={<div className="flex h-[220px] items-center justify-center text-[13px] text-text-3">Loading funnel…</div>}>
                    <div className="mt-3">
                      <PipelineFunnel stages={funnel.stages} offFunnel={funnel.offFunnel} totalLeads={funnel.totalLeads} coldCount={funnel.coldCount} />
                    </div>
                  </Suspense>
                </div>
              )}

              <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
                <div className="card">
                  <CardHeader icon={Hash} title="Pipeline Breakdown" />
                  <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-surface-3">
                    {STAGE_ORDER.filter((s) => stats.stageCounts[s] > 0).map((s) => (
                      <div
                        key={s}
                        style={{ width: `${(stats.stageCounts[s] / Math.max(stats.total, 1)) * 100}%`, background: STAGE_CONFIG[s].color }}
                        title={`${STAGE_CONFIG[s].label}: ${stats.stageCounts[s]}`}
                      />
                    ))}
                  </div>
                  <div className="mt-3">
                    {STAGE_ORDER.map((s) => (
                      <BarRow key={s} label={STAGE_CONFIG[s].label} count={stats.stageCounts[s]} max={maxStage} color={STAGE_CONFIG[s].color} />
                    ))}
                  </div>
                </div>
                {showSmsStats ? (
                  <div className="card">
                    <CardHeader icon={Phone} title="Sent By Number" tone="info" />
                    <div className="mt-2">
                      {stats.numberCounts.length === 0 ? (
                        <div className="text-[13px] text-text-3">No sends in this range.</div>
                      ) : (
                        stats.numberCounts.map((n) => <BarRow key={n.phone} label={n.label} count={n.count} max={maxNumber} color="#0891b2" />)
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="card">
                    <CardHeader icon={TagsIcon} title="Tag Breakdown" tone="accent" />
                    <div className="mt-2">
                      {stats.tagCounts.length === 0 && <div className="text-[13px] text-text-3">No tagged leads yet.</div>}
                      {stats.tagCounts.map(({ tag, count }) => (
                        <BarRow key={tag.id} label={tag.name} count={count} max={maxTag} color={tag.colorText} />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {showSmsStats && (
                <div className="card">
                  <CardHeader icon={TagsIcon} title="Tag Breakdown" tone="accent" />
                  <div className="mt-2">
                    {stats.tagCounts.length === 0 ? (
                      <div className="text-[13px] text-text-3">No tagged leads yet.</div>
                    ) : (
                      <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                        {stats.tagCounts.map(({ tag, count }) => (
                          <BarRow key={tag.id} label={tag.name} count={count} max={maxTag} color={tag.colorText} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {showSmsStats && (
            <div>
              <SectionLabel>Marketing</SectionLabel>
              <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-3">
                <div className="card lg:col-span-2">
                  <CardHeader icon={Megaphone} title="Lead Volume" sub="new leads per week, last 12 weeks" />
                  {(() => {
                    const max = Math.max(...leadVolumeTrend.map((w) => w.count), 1);
                    return (
                      // `items-stretch` (the default, made explicit here) so
                      // each week column actually inherits this row's 120px
                      // height — with `items-end` instead, a column had no
                      // definite height of its own, so the child below with
                      // height:{pct}% had nothing real to be a percentage
                      // of and rendered at 0px regardless of lead count.
                      <div className="mt-4 flex items-stretch gap-1.5" style={{ height: 120 }}>
                        {leadVolumeTrend.map((w) => (
                          <div key={w.label} className="flex flex-1 flex-col items-center gap-1">
                            {/* A faint full-height track behind the bar so a genuinely
                                small week (real leads, just few of them) still reads as
                                "a little" against the axis, not indistinguishable from
                                zero next to a much bigger historical import spike. */}
                            <div className="relative flex w-full flex-1 items-end rounded-t-sm bg-surface-3">
                              <div
                                className="w-full rounded-t-sm bg-primary"
                                style={{ height: `${Math.max((w.count / max) * 100, 4)}%` }}
                                title={`${w.label}: ${w.count} lead${w.count === 1 ? '' : 's'}`}
                              />
                            </div>
                            <div className="text-[9px] text-text-3">{w.label}</div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                <div className="card">
                  <CardHeader icon={DollarSign} title="Spend & Source Coverage" tone="accent" />
                  <div className="mt-3 space-y-3">
                    <div>
                      <div className="text-[11px] text-text-3">Marketing spend logged</div>
                      <div className="font-mono text-xl font-semibold tabular-nums text-text">
                        ${marketingSnapshot.totalSpend.toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between text-[11px] text-text-3">
                        <span>Leads with a source tagged</span>
                        <span className="font-mono tabular-nums">
                          {marketingSnapshot.tagged.toLocaleString()} / {marketingSnapshot.total.toLocaleString()}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${marketingSnapshot.taggedPct > 0 ? Math.max(marketingSnapshot.taggedPct, 2) : 0}%` }}
                        />
                      </div>
                    </div>
                    <p className="text-[11px] text-text-3">
                      Cost Per Lead and CAC need more real spend logged and more leads tagged with a source before
                      they'd mean anything — shown as plain totals for now, not a $/lead ratio.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div>
            <SectionLabel>Activity</SectionLabel>
            <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label="Current Streak"
                value={heatmap.currentStreak}
                sub={heatmap.currentStreak === 0 ? 'Start today!' : `${heatmap.currentStreak} day${heatmap.currentStreak !== 1 ? 's' : ''} in a row`}
                color="#f59e0b"
                icon={Flame}
              />
              <StatCard label="Active Days" value={heatmap.activeDays} sub="active days this year" color="#10b981" icon={CalendarDays} />
              <StatCard label="Best Streak" value={heatmap.bestStreak} sub="personal best" color="#06b6d4" icon={Trophy} />
              <StatCard
                label="This Week"
                value={`${heatmap.thisWeekActive}/${heatmap.thisWeekTotal}`}
                sub="days active so far"
                color="#a78bfa"
                icon={Sparkles}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function DashboardPage() {
  const { session, profile } = useAuth();
  const userId = session?.user.id ?? '';

  if (!session) return null;
  return <DashboardView userId={userId} profile={profile} allowStartSession showSmsStats={profile?.role === 'admin'} />;
}
