import { lazy, Suspense, useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotificationsContext } from '@/contexts/NotificationsContext';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Bot,
  CalendarCheck,
  CalendarDays,
  DollarSign,
  FileSignature,
  Flame,
  Gauge,
  Handshake,
  Map as MapIcon,
  Medal,
  Megaphone,
  MessageSquare,
  Phone,
  PhoneCall,
  PhoneIncoming,
  Plus,
  Reply,
  Search,
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
import { useLeads, useLeadsTotalCount } from '@/hooks/useLeads';
import { useActivityFeed, useStageChangeHistory } from '@/hooks/useActivities';
import { useTags } from '@/hooks/useTags';
import { useSendLog, useInboundMessages, useSmsDeliveryLog, useCashBuyerPhones } from '@/hooks/useSmsStats';
import { useAuth } from '@/contexts/AuthContext';
import { STAGE_CONFIG, STAGE_ORDER, type LeadStage, type Profile } from '@/types/domain';
import { cn, localIsoDate } from '@/lib/utils';
import { CardHeader, SectionLabel } from '@/components/ui/CardHeader';
import { RadialGauge } from '@/components/ui/RadialGauge';
import { useTeamMembers } from '@/hooks/useTeam';
import { useOrgLeads, useOrgActivities, computeRepLeaderboard, computeDealVelocity } from '@/hooks/useSalesKpis';
import { isMajorCity } from '@/lib/majorCities';

type SmsRangeKey = '1d' | '7d' | '30d' | '90d' | 'all';
const SMS_RANGE_OPTIONS: { key: SmsRangeKey; label: string }[] = [
  { key: '1d', label: '1D' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: '90d', label: '90D' },
  { key: 'all', label: 'Lifetime' },
];

const PipelineActivityChart = lazy(() =>
  import('@/components/dashboard/PipelineActivityChart').then((m) => ({ default: m.PipelineActivityChart })),
);
const CityPerformanceMap = lazy(() =>
  import('@/components/dashboard/CityPerformanceMap').then((m) => ({ default: m.CityPerformanceMap })),
);
const PipelineFunnel = lazy(() =>
  import('@/components/dashboard/PipelineFunnel').then((m) => ({ default: m.PipelineFunnel })),
);
const CallProgressChart = lazy(() =>
  import('@/components/dashboard/CallProgressChart').then((m) => ({ default: m.CallProgressChart })),
);
const RevenueInPipelineChart = lazy(() =>
  import('@/components/dashboard/RevenueInPipelineChart').then((m) => ({ default: m.RevenueInPipelineChart })),
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
  if (stage === 'contract' || stage === 'inspection_walkthrough' || stage === 'in_title' || stage === 'closed') return 'contract';
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

/** Tiny filled-area trend line for a hero stat card — real values only, no
 * decorative/fabricated data. Needs at least 2 points to draw anything. */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const id = useId();
  if (values.length < 2) return <svg width="96" height="40" aria-hidden="true" />;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const stepX = 96 / (values.length - 1);
  const points = values.map((v, i) => `${(i * stepX).toFixed(1)},${(38 - ((v - min) / range) * 34).toFixed(1)}`).join(' ');
  return (
    <svg width="96" height="40" viewBox="0 0 96 40" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,40 ${points} 96,40`} fill={`url(#${id})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** One hero metric card — icon badge, headline number, a real trend chip
 * (vs the earlier half of the same series), and the sparkline behind it.
 * Matches the Tristate Ledger redesign's "Overview" row exactly. */
function HeroStatCard({
  icon: Icon,
  label,
  value,
  valueSuffix,
  sub,
  trendPct,
  series,
  color,
  formatValue,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  /** e.g. " deals" — rendered smaller/muted right after the number. */
  valueSuffix?: string;
  sub: string;
  trendPct: number;
  series: number[];
  color: string;
  formatValue?: (v: number) => string;
}) {
  const up = trendPct >= 0;
  return (
    <div className="card flex flex-col gap-3.5 !p-5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px]" style={{ background: `${color}24`, color }}>
          <Icon size={17} strokeWidth={1.7} />
        </span>
        <span className="text-sm font-medium text-text-2">{label}</span>
      </div>
      <div className="flex items-end justify-between gap-2.5">
        <div>
          <div className="font-mono text-[28px] font-bold leading-none tracking-tight text-text">
            {formatValue ? formatValue(value) : value.toLocaleString()}
            {valueSuffix && <span className="ml-1 font-sans text-[15px] font-medium text-text-3">{valueSuffix}</span>}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded-full px-2 py-[3px] text-xs font-semibold',
                up ? 'bg-success-dim text-success' : 'bg-danger-dim text-danger',
              )}
            >
              {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
              {Math.abs(trendPct).toFixed(1)}%
            </span>
            <span className="text-[12.5px] text-text-3">{sub}</span>
          </div>
        </div>
        <Sparkline values={series} color={color} />
      </div>
    </div>
  );
}

function money(v: number): string {
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

/** Donut chart for a labeled breakdown (Pipeline tag breakdown) — real
 * per-tag colors (tag.colorText, the admin's own assigned color), not an
 * invented palette, so it always matches the Tags UI elsewhere in the CRM. */
function DonutChart({
  segments,
  total,
  centerLabel,
}: {
  segments: { label: string; count: number; color: string }[];
  total: number;
  centerLabel: string;
}) {
  const size = 140;
  const strokeWidth = 16;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  let offsetAccum = 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`${total.toLocaleString()} ${centerLabel}: ${segments.map((s) => `${s.label} ${s.count}`).join(', ')}`}
    >
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`} fill="none" strokeWidth={strokeWidth}>
        {segments.map((s) => {
          const frac = total > 0 ? s.count / total : 0;
          const dash = Math.max(frac * circumference, frac > 0 ? 1 : 0);
          const el = (
            <circle
              key={s.label}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={s.color}
              strokeDasharray={`${dash} ${circumference}`}
              strokeDashoffset={-offsetAccum}
            />
          );
          offsetAccum += dash;
          return el;
        })}
      </g>
      <text x={size / 2} y={size / 2 - 4} textAnchor="middle" className="fill-text" style={{ fontSize: 22, fontWeight: 700 }}>
        {total.toLocaleString()}
      </text>
      <text x={size / 2} y={size / 2 + 15} textAnchor="middle" className="fill-text-3" style={{ fontSize: 11 }}>
        {centerLabel}
      </text>
    </svg>
  );
}

/** Gradient-filled trend line for a full-width card (SMS activity /
 * City/Lead volume style cards) — same real-data-only approach as
 * Sparkline, just sized for a card body instead of a hero tile. */
function AreaTrendChart({ points, color, height = 150 }: { points: { label: string; count: number }[]; color: string; height?: number }) {
  const id = useId();
  const width = 600;
  const max = Math.max(...points.map((p) => p.count), 1);
  const stepX = points.length > 1 ? width / (points.length - 1) : width;
  const coords = points.map((p, i) => ({ x: i * stepX, y: height - (p.count / max) * (height - 24) - 6 }));
  const linePoints = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const last = coords[coords.length - 1];
  const labelIdxs = points.length > 1 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : [0];
  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.32" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,${height} ${linePoints} ${width},${height}`} fill={`url(#${id})`} />
        <polyline points={linePoints} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {last && <circle cx={last.x} cy={last.y} r="4.5" fill={color} />}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-text-3">
        {labelIdxs.map((i) => (
          <span key={i}>{points[i]?.label}</span>
        ))}
      </div>
    </div>
  );
}

function timeOfDayGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function StatCard({
  label,
  value,
  sub,
  color,
  icon: Icon,
  hero,
  compact,
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
  /** Tighter padding/type for a denser grid (e.g. 2-col × 4-row next to a
   * chart) — same visual language as the regular size, just smaller. */
  compact?: boolean;
}) {
  if (hero) {
    // hero is a solid-color block, so it needs a real background color
    // regardless — this fallback only matters if a future call site forgets
    // one, so it still gets real contrast instead of transparent/black.
    const bg = color ?? '#1568A8';
    return (
      <div
        className={`rounded-lg shadow-card transition-transform hover:-translate-y-0.5 hover:shadow-card-hover ${compact ? 'p-2.5' : 'p-4'}`}
        style={{ background: bg }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className={`font-semibold uppercase tracking-wide text-white/70 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>{label}</div>
          {Icon && (
            <span className={`flex shrink-0 items-center justify-center rounded-md bg-white/15 text-white ${compact ? 'h-6 w-6' : 'h-7 w-7'}`}>
              <Icon size={compact ? 12 : 14} />
            </span>
          )}
        </div>
        <div className={`font-mono font-semibold tabular-nums text-white ${compact ? 'mt-1 text-lg' : 'mt-2 text-2xl'}`}>{value}</div>
        <div className={`text-white/75 ${compact ? 'text-[11px]' : 'mt-0.5 text-[12px]'}`}>{sub}</div>
      </div>
    );
  }
  // color is genuinely optional here — a plain activity count that isn't
  // inherently good or bad (Total Leads, SMS Sent, ...) renders as a true
  // neutral card (muted icon badge, default text color) rather than being
  // forced into a fake "neutral-looking" hex just to satisfy a required
  // prop. Only cards that actually carry a signal (success/danger/info/the
  // one primary anchor metric) pass a real color.
  return (
    <div className={`card transition-transform hover:-translate-y-0.5 hover:shadow-card-hover ${compact ? '!p-2.5' : '!p-4'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className={`font-semibold uppercase tracking-wide text-text-3 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>{label}</div>
        {Icon && (
          <span
            className={`flex shrink-0 items-center justify-center rounded-md ${compact ? 'h-6 w-6' : 'h-7 w-7'} ${color ? '' : 'bg-surface-3 text-text-3'}`}
            style={color ? { background: `${color}17`, color } : undefined}
          >
            <Icon size={compact ? 12 : 14} />
          </span>
        )}
      </div>
      <div
        className={`font-mono font-semibold tabular-nums ${compact ? 'mt-1 text-lg' : 'mt-2 text-2xl'} ${color ? '' : 'text-text'}`}
        style={color ? { color } : undefined}
      >
        {value}
      </div>
      <div className={`text-text-3 ${compact ? 'text-[11px]' : 'mt-0.5 text-[12px]'}`}>{sub}</div>
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
  showSmsStats = false,
}: {
  userId: string;
  profile: Profile | null;
  heading?: string;
  subtitle?: string;
  /** SMS outreach is an admin-only feature (RLS enforces this server-side
   * too — a caller's send_log/inbound_messages query just comes back empty),
   * and it's account-wide rather than per-caller, so the unified pipeline
   * view only ever renders on the admin's own "/" dashboard, never on a team
   * member's individual dashboard. */
  showSmsStats?: boolean;
}) {
  const navigate = useNavigate();
  const { unreadCount } = useNotificationsContext();
  const { data: leads = [], isFetching: leadsFetching, isError: leadsErrored } = useLeads(userId);
  // The account's real total, straight from the DB — leads itself can lag
  // behind reality for a while (see useLeads' own staleTime), and a raw
  // count is the one number where that's immediately, visibly wrong to
  // anyone cross-checking against the Leads page. This one query is cheap
  // enough to always stay fresh (App.tsx's default 5-min staleTime, not the
  // long-lived one useLeads uses), so it's worth pulling separately here
  // rather than trusting leads.length.
  const { data: totalLeadsCount = 0 } = useLeadsTotalCount(userId);
  const { data: activities = [] } = useActivityFeed(userId);
  const { data: stageChangeHistory = [] } = useStageChangeHistory(userId);
  const { data: tags = [] } = useTags(userId);
  const { data: sendLog = [] } = useSendLog(showSmsStats);
  const { data: inboundMessages = [] } = useInboundMessages(showSmsStats);
  const { data: smsDeliveryLog = [] } = useSmsDeliveryLog(showSmsStats);
  const { data: buyerPhones = new Set<string>() } = useCashBuyerPhones(showSmsStats);
  const { data: teamMembers = [] } = useTeamMembers();
  const { data: orgLeads = [] } = useOrgLeads(showSmsStats);
  const { data: orgActivities = [] } = useOrgActivities(showSmsStats);

  // Overview stats (Total Leads, SMS Sent, Replies, Qualified, etc.) are
  // always all-time — there used to be a page-wide Today/7D/30D/90D/All
  // toggle driving these, but it didn't do anything a reader could actually
  // see changing other than this row's own numbers (every other chart on
  // this page already has its own independent range control), so it was
  // just a redundant, confusing extra selector rather than a useful filter.
  const inRange = (_iso: string) => true;

  // The SMS Delivery & Reply Rate card gets its own timeline, independent of
  // the page-wide control above — Zoom's own report is checked at whatever
  // window someone actually wants (a single bad day, this week, this
  // quarter), not locked to the same range as every other card.
  const [smsRange, setSmsRange] = useState<SmsRangeKey>('7d');
  // Pipeline Activity gets the same independent-range treatment — same
  // reasoning as smsRange above.
  const [activityRange, setActivityRange] = useState<SmsRangeKey>('30d');

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

  // The weakest single stage-to-stage transition — what the funnel bars'
  // own callout below points at, same "biggest leak" framing the mockup
  // uses, computed from these same real cumulative counts rather than
  // picked by hand.
  const biggestLeak = useMemo(() => {
    let worst: { from: string; to: string; rate: number } | null = null;
    for (let i = 0; i < funnel.stages.length - 1; i++) {
      const from = funnel.stages[i];
      const to = funnel.stages[i + 1];
      if (from.count === 0) continue;
      const rate = to.count / from.count;
      if (!worst || rate < worst.rate) worst = { from: from.label, to: to.label, rate };
    }
    return worst;
  }, [funnel]);

  // ── Sales: funnel efficiency (contact/qualify/contract/close rate) ────────
  // Mostly reuses the same cumulative funnel counts already computed above
  // for the Pipeline card, expressed as stage-to-stage percentages instead
  // of a bar chart — except Contract Rate and Close Rate, which can't just
  // read funnel.stages[5] (current-stage-based) the way the old single
  // "Close Rate" used to. A contract has two outcomes, close or fall
  // through, and a fallen-through one gets dragged to Dead/Declined —
  // dropping it out of the contract-or-beyond bucket entirely and making it
  // vanish from both rates instead of counting toward Contract Rate (it DID
  // get a contract) while correctly missing Close Rate (it never actually
  // closed). stageChangeHistory (full stage-change history, not just
  // current stage — already fetched above for Revenue in Pipeline) is what
  // makes "ever reached Contract" answerable regardless of where the lead
  // sits today.
  const CONTRACT_STAGES = useMemo(
    () => new Set<LeadStage>(['contract', 'inspection_walkthrough', 'in_title', 'closed']),
    [],
  );
  const funnelEfficiency = useMemo(() => {
    const contactedOrBeyond = funnel.stages[0]?.count ?? 0;
    const qualifiedOrBeyond = funnel.stages[3]?.count ?? 0;

    const everReachedContractIds = new Set(
      stageChangeHistory.filter((e) => CONTRACT_STAGES.has(e.to as LeadStage)).map((e) => e.leadId),
    );
    // Belt and suspenders — a lead currently sitting in a contract-or-beyond
    // stage always counts too, even if its own stage_change history is
    // missing or incomplete (e.g. predates this logging).
    for (const l of leads) {
      if (CONTRACT_STAGES.has(l.stage)) everReachedContractIds.add(l.id);
    }
    const everReachedContract = everReachedContractIds.size;
    const closedCount = leads.filter((l) => l.stage === 'closed').length;

    return {
      contactRate: funnel.totalLeads > 0 ? (contactedOrBeyond / funnel.totalLeads) * 100 : 0,
      qualifyRate: contactedOrBeyond > 0 ? (qualifiedOrBeyond / contactedOrBeyond) * 100 : 0,
      contractRate: qualifiedOrBeyond > 0 ? (everReachedContract / qualifiedOrBeyond) * 100 : 0,
      closeRate: everReachedContract > 0 ? (closedCount / everReachedContract) * 100 : 0,
    };
  }, [funnel, leads, stageChangeHistory, CONTRACT_STAGES]);

  // ── Sales: headline metric cards (real weekly series, not decoration) ─────
  // Each card's sparkline and trend chip come from the same underlying
  // event timestamps as the rest of this page (lead creation, real
  // stage_change history) bucketed into 8 real weeks — never a fabricated
  // or placeholder series. The headline number is the more recent half
  // (last ~4 weeks); the trend chip compares it against the earlier half.
  const heroMetrics = useMemo(() => {
    const WEEKS = 8;
    function weeklyCounts(dates: string[]): number[] {
      const now = Date.now();
      const buckets = new Array(WEEKS).fill(0) as number[];
      for (const iso of dates) {
        const daysAgo = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
        const idx = WEEKS - 1 - Math.floor(daysAgo / 7);
        if (idx >= 0 && idx < WEEKS) buckets[idx]++;
      }
      return buckets;
    }
    function summarize(series: number[]) {
      const half = Math.floor(series.length / 2);
      const earlier = series.slice(0, half).reduce((a, b) => a + b, 0);
      const recent = series.slice(half).reduce((a, b) => a + b, 0);
      const trendPct = earlier > 0 ? ((recent - earlier) / earlier) * 100 : recent > 0 ? 100 : 0;
      return { series, value: recent, trendPct };
    }

    // "Under contract" and "In negotiation" headline numbers are a live
    // snapshot (matches the Kanban board right now), same framing as
    // funnel.stages — but the sparkline/trend chip underneath is still the
    // real weekly rate of leads newly ENTERING that stage, since a plain
    // snapshot has no meaningful week-by-week shape of its own.
    const underContractLeads = leads.filter((l) => CONTRACT_STAGES.has(l.stage) && l.stage !== 'closed');
    const underContractFees = underContractLeads.reduce((sum, l) => sum + (l.assignmentFee ?? 0), 0);
    const negotiationCount = leads.filter((l) => l.stage === 'negotiation').length;

    return {
      newLeads: summarize(weeklyCounts(leads.map((l) => l.createdAt))),
      underContract: {
        ...summarize(weeklyCounts(stageChangeHistory.filter((e) => e.to === 'contract').map((e) => e.createdAt))),
        value: underContractLeads.length,
        fees: underContractFees,
      },
      negotiation: {
        ...summarize(weeklyCounts(stageChangeHistory.filter((e) => e.to === 'negotiation').map((e) => e.createdAt))),
        value: negotiationCount,
      },
    };
  }, [leads, stageChangeHistory, CONTRACT_STAGES]);

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

  // Daily outbound SMS volume, last 14 days — real counts from
  // smsDeliveryLog (same source smsCampaignStats reads), buyer
  // conversations excluded for the same reason noted there.
  const dailySmsVolume = useMemo(() => {
    const DAYS = 14;
    const dayMap = new Map<string, number>();
    for (const r of smsDeliveryLog) {
      if (r.direction !== 'Out') continue;
      const counterparty = r.counterpartyNumber?.replace(/[^0-9]/g, '').slice(-10);
      if (counterparty && buyerPhones.has(counterparty)) continue;
      const iso = localIsoDate(new Date(r.occurredAt));
      dayMap.set(iso, (dayMap.get(iso) ?? 0) + 1);
    }
    const out: { iso: string; label: string; count: number }[] = [];
    const today = new Date();
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const iso = localIsoDate(d);
      out.push({ iso, label: String(d.getDate()), count: dayMap.get(iso) ?? 0 });
    }
    return out;
  }, [smsDeliveryLog, buyerPhones]);

  // ── Marketing: which states/cities/zips are actually converting — scored
  // by real deal outcomes, not raw reply chatter, so spend/outreach can be
  // pointed at what's already working instead of split evenly across
  // everywhere leads happen to come from. Scoped to contacted-or-beyond
  // leads only (stage !== 'new') — with ~4k cold, never-approached leads
  // still sitting on the board, a rate needs to be "of the leads we
  // actually reached out to," not diluted by leads nobody has touched yet.
  //
  // Three nested levels for the map's click-to-drill-down (state -> its
  // cities -> a city's zips): a STATE's own total/qualified/contracts/replied
  // count every contacted lead in it regardless of city size, so it's never
  // artificially low just because most of its leads sit in small cities.
  // Cities and zips both apply a MIN_LEADS=3 floor before getting their own
  // tier — a single lucky/unlucky lead would otherwise swing one to a 100%
  // or 0% rate and dominate a tier it doesn't really belong in — and drop
  // out of their parent's list entirely below that floor. Cities are also
  // restricted to major cities (70k+ population, see majorCities.ts) — small
  // towns/hamlets are both statistically noisy at this volume and rarely
  // have a real Census place boundary to shade in on the state-level map, so
  // they rendered as plain circles instead. States need a much
  // higher floor (MIN_STATE_LEADS=300): a state with 30 contacts and 1 reply
  // was showing up as "best market" purely because its tiny sample produced
  // a noisy rate, not because it's actually performing — anything under 300
  // contacted leads isn't a real market yet and is dropped from the map
  // entirely (renders neutral, unclickable) rather than tiered against
  // states doing real volume. Tiers at every level are relative (top/middle/
  // bottom third *within that level*, e.g. a zip ranked against its own
  // city's other zips, not nationally) rather than fixed thresholds, since
  // what counts as "good" varies by business.
  //
  // Score weights actual deal progress, not just engagement: contracts (the
  // real outcome) count most, the full qualified funnel (partial-qualified
  // through closed — everyone who progressed past a reply) counts next, and
  // raw reply rate — the earliest and noisiest signal — counts least. A
  // market that closes contracts always outranks one that merely replies
  // well but never converts.
  const stateStats = useMemo(() => {
    const MIN_LEADS = 3;
    const MIN_STATE_LEADS = 300;
    if (!showSmsStats) return [];

    const repliedLeadIds = new Set(inboundMessages.filter((m) => !m.isReaction && m.leadId).map((m) => m.leadId as string));

    const MAP_QUALIFIED_STAGES: LeadStage[] = [
      'initial_contact',
      'followup',
      'negotiation',
      'contract',
      'inspection_walkthrough',
      'in_title',
      'closed',
    ];
    const MAP_CONTRACT_STAGES: LeadStage[] = ['contract', 'inspection_walkthrough', 'in_title', 'closed'];

    interface ContractProperty {
      id: string;
      address: string;
      city: string;
      state: string;
    }
    interface Bucket {
      total: number;
      qualified: number;
      contracts: number;
      leadIds: string[];
      // Only ever populated on a zip-level bucket (zg below) — city/state
      // buckets share this same type but never read it. One entry per
      // under-contract/in-negotiation/partial-qualified/qualified lead in
      // this zip, feeding CityZipMap's property pins.
      contractProperties: ContractProperty[];
      negotiationProperties: ContractProperty[];
      partialQualifiedProperties: ContractProperty[];
      qualifiedProperties: ContractProperty[];
    }
    const byCity = new Map<
      string,
      {
        city: string;
        state: string;
        total: number;
        qualified: number;
        contracts: number;
        leadIds: string[];
        zipGroups: Map<string, Bucket>;
      }
    >();
    // Independent of byCity's own MIN_LEADS floor below — a state's total
    // must reflect every contacted lead in it, not just the ones that
    // happened to land in a city big enough to get its own tier.
    const byState = new Map<string, Bucket>();
    for (const l of leads) {
      if (l.stage === 'new') continue; // still cold — never approached
      if (!l.city?.trim() || !l.state?.trim() || l.state.trim().length !== 2) continue;
      const cityKey = l.city.trim().toLowerCase();
      const stateKey = l.state.trim().toUpperCase();
      const key = `${cityKey}|${stateKey}`;
      let entry = byCity.get(key);
      if (!entry) {
        entry = { city: l.city.trim(), state: stateKey, total: 0, qualified: 0, contracts: 0, leadIds: [], zipGroups: new Map() };
        byCity.set(key, entry);
      }
      const isQualified = MAP_QUALIFIED_STAGES.includes(l.stage);
      const isContract = MAP_CONTRACT_STAGES.includes(l.stage);
      const isNegotiation = l.stage === 'negotiation';
      const isPartialQualified = l.stage === 'initial_contact';
      const isFullyQualified = l.stage === 'followup';
      entry.total++;
      entry.leadIds.push(l.id);
      if (isQualified) entry.qualified++;
      if (isContract) entry.contracts++;

      let stateEntry = byState.get(stateKey);
      if (!stateEntry) {
        stateEntry = {
          total: 0,
          qualified: 0,
          contracts: 0,
          leadIds: [],
          contractProperties: [],
          negotiationProperties: [],
          partialQualifiedProperties: [],
          qualifiedProperties: [],
        };
        byState.set(stateKey, stateEntry);
      }
      stateEntry.total++;
      stateEntry.leadIds.push(l.id);
      if (isQualified) stateEntry.qualified++;
      if (isContract) stateEntry.contracts++;

      // Zip is often stored as ZIP+4 ("33610-6838") — normalized to the
      // base 5 digits so both halves of a split zip+4 code count together.
      const zip5 = l.zip?.trim().match(/^\d{5}/)?.[0];
      if (zip5) {
        let zg = entry.zipGroups.get(zip5);
        if (!zg) {
          zg = {
            total: 0,
            qualified: 0,
            contracts: 0,
            leadIds: [],
            contractProperties: [],
            negotiationProperties: [],
            partialQualifiedProperties: [],
            qualifiedProperties: [],
          };
          entry.zipGroups.set(zip5, zg);
        }
        zg.total++;
        zg.leadIds.push(l.id);
        if (isQualified) zg.qualified++;
        if (isContract) {
          zg.contracts++;
          if (l.address?.trim()) {
            zg.contractProperties.push({ id: l.id, address: l.address.trim(), city: l.city!.trim(), state: stateKey });
          }
        }
        if (isNegotiation && l.address?.trim()) {
          zg.negotiationProperties.push({ id: l.id, address: l.address.trim(), city: l.city!.trim(), state: stateKey });
        }
        if (isPartialQualified && l.address?.trim()) {
          zg.partialQualifiedProperties.push({ id: l.id, address: l.address.trim(), city: l.city!.trim(), state: stateKey });
        }
        if (isFullyQualified && l.address?.trim()) {
          zg.qualifiedProperties.push({ id: l.id, address: l.address.trim(), city: l.city!.trim(), state: stateKey });
        }
      }
    }

    // Contracts weighted above the qualified funnel, which is weighted
    // above raw reply rate — see the doc comment above this memo.
    function scoreOf(total: number, qualified: number, contracts: number, replied: number): number {
      if (total === 0) return 0;
      const contractRate = contracts / total;
      const qualifyRate = qualified / total;
      const replyRate = replied / total;
      return contractRate * 0.5 + qualifyRate * 0.3 + replyRate * 0.2;
    }

    // Ranks a set of {score}-carrying rows into relative thirds — top third
    // green, middle yellow, bottom red — via object identity, not a key
    // string, so it works the same for city rows and zip rows alike.
    function tierRank<T extends { score: number }>(items: T[]): Map<T, 'green' | 'yellow' | 'red'> {
      const ranked = [...items].sort((a, b) => b.score - a.score);
      const n = ranked.length;
      const map = new Map<T, 'green' | 'yellow' | 'red'>();
      ranked.forEach((item, i) => {
        const pos = n > 1 ? i / (n - 1) : 0;
        map.set(item, pos <= 1 / 3 ? 'green' : pos <= 2 / 3 ? 'yellow' : 'red');
      });
      return map;
    }

    const cityRows = Array.from(byCity.entries())
      .map(([key, e]) => {
        const [cityKey, stateKey] = key.split('|');
        const replied = e.leadIds.filter((id) => repliedLeadIds.has(id)).length;
        const qualifyRate = e.total > 0 ? e.qualified / e.total : 0;
        const replyRate = e.total > 0 ? replied / e.total : 0;
        const contractRate = e.total > 0 ? e.contracts / e.total : 0;

        const zipRows = Array.from(e.zipGroups.entries())
          .map(([zip5, zg]) => {
            const zReplied = zg.leadIds.filter((id) => repliedLeadIds.has(id)).length;
            const zQualifyRate = zg.total > 0 ? zg.qualified / zg.total : 0;
            const zReplyRate = zg.total > 0 ? zReplied / zg.total : 0;
            const zContractRate = zg.total > 0 ? zg.contracts / zg.total : 0;
            return {
              zip5,
              city: e.city,
              state: stateKey,
              total: zg.total,
              qualified: zg.qualified,
              qualifyRate: zQualifyRate,
              contracts: zg.contracts,
              contractRate: zContractRate,
              replied: zReplied,
              replyRate: zReplyRate,
              score: scoreOf(zg.total, zg.qualified, zg.contracts, zReplied),
              contractProperties: zg.contractProperties,
              negotiationProperties: zg.negotiationProperties,
              partialQualifiedProperties: zg.partialQualifiedProperties,
              qualifiedProperties: zg.qualifiedProperties,
            };
          })
          .filter((z) => z.total >= MIN_LEADS);
        const zipTiers = tierRank(zipRows);
        const zips = zipRows.map((z) => ({ ...z, tier: zipTiers.get(z)! }));

        return {
          cityKey,
          stateKey,
          city: e.city,
          state: e.state,
          total: e.total,
          qualified: e.qualified,
          qualifyRate,
          contracts: e.contracts,
          contractRate,
          replied,
          replyRate,
          score: scoreOf(e.total, e.qualified, e.contracts, replied),
          zips,
        };
      })
      // Major cities only (70k+ population, see majorCities.ts) — small
      // towns/hamlets rarely have a Census Incorporated Place boundary to
      // draw at all (they showed up as unshaded circles instead of the real
      // boundary shading every other city gets) and, being tiny slices of a
      // state's contacted leads, add noise more than signal at this zoom
      // level anyway.
      .filter((c) => c.total >= MIN_LEADS && isMajorCity(c.city, c.stateKey));

    const cityTiers = tierRank(cityRows);
    const citiesWithTier = cityRows.map((c) => ({ ...c, tier: cityTiers.get(c)! }));

    const stateRows = Array.from(byState.entries())
      .map(([stateKey, e]) => {
        const replied = e.leadIds.filter((id) => repliedLeadIds.has(id)).length;
        const qualifyRate = e.total > 0 ? e.qualified / e.total : 0;
        const replyRate = e.total > 0 ? replied / e.total : 0;
        const contractRate = e.total > 0 ? e.contracts / e.total : 0;
        return {
          stateKey,
          state: stateKey,
          total: e.total,
          qualified: e.qualified,
          qualifyRate,
          contracts: e.contracts,
          contractRate,
          replied,
          replyRate,
          score: scoreOf(e.total, e.qualified, e.contracts, replied),
          cities: citiesWithTier.filter((c) => c.stateKey === stateKey),
        };
      })
      .filter((s) => s.total >= MIN_STATE_LEADS);
    const stateTiers = tierRank(stateRows);
    return stateRows.map((s) => ({ ...s, tier: stateTiers.get(s)! }));
  }, [leads, inboundMessages, showSmsStats]);

  const stats = useMemo(() => {
    const total = leads.length;
    const contactedOrBeyond = leads.filter((l) => l.stage !== 'new').length;
    const qualified = qualifiedPlusIds.size;
    // Contract, In Title, and Closed are the three phases of the same deal
    // (see funnelBucket above and revenueInPipelineTrend below) — a lead
    // that's progressed past Contract shouldn't disappear from this count.
    const contracts = leads.filter(
      (l) => l.stage === 'contract' || l.stage === 'inspection_walkthrough' || l.stage === 'in_title' || l.stage === 'closed',
    ).length;
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
    const totalCalls = callsInRange.length;

    const smsActivitiesInRange = activities.filter((a) => a.type === 'sms' && inRange(a.createdAt));
    const aiRepliesSent = smsActivitiesInRange.filter((a) => {
      const meta = a.meta as { direction?: string; aiGenerated?: boolean };
      return meta?.direction === 'outbound' && meta?.aiGenerated;
    }).length;
    const totalSms = sendLogInRange.length + repliesInRange.length;

    // Every lead that reaches Qualified does so through the AI texting
    // flow — there's no other path to that stage in practice — so this is
    // just the same count as `qualified` above. (A text-match against the
    // "AI Qualification Summary" block ai-reply writes to Notes was tried
    // first, but undercounted — real qualified leads whose Notes had since
    // been edited or didn't carry that exact marker. Since the two counts
    // are the same thing in this business, there's no separate number to
    // reconstruct here.)
    const aiQualifiedCount = qualified;

    const sentToday = sendLog.filter((r) => localIsoDate(new Date(r.createdAt)) === localIsoDate(new Date())).length;

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
      totalCalls,
      aiRepliesSent,
      totalSms,
      aiQualifiedCount,
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
  }, [leads, calls, tags, activities, sendLog, inboundMessages, qualifiedPlusIds]);

  // Driven by its own activityRange toggle rather than the page-wide range
  // — 90D and Lifetime both cap at 90 days of buckets (a daily trend chart
  // stretching years back isn't useful or fast to render).
  const trendDayCount =
    activityRange === '1d' ? 1 : activityRange === '7d' ? 7 : activityRange === '30d' ? 30 : 90;

  const activityTrend = useMemo(() => {
    const days: Array<{ iso: string; label: string; sent: number; replies: number; qualified: number }> = [];
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
    return days;
  }, [sendLog, inboundMessages, leads, trendDayCount]);

  // "Expected revenue" = total assignment fee across every lead that has
  // reached Under Contract and hasn't fallen out of that track since —
  // Contract, In Title, and Closed are the three phases of the SAME deal
  // (Contract -> In Title -> Closed is where the fee actually gets paid),
  // not separate pots, so a lead progressing through them should never look
  // like the money disappeared. "Actual revenue" is the narrower, realized
  // slice of that same money — only the fee for leads that have actually
  // landed in Closed, nothing still in Contract or In Title, since that's
  // the only point the deal is actually done. "Currently" only tells you
  // today's number, and the point of a trend chart is the months before
  // today too. Reconstructed from each lead's real stage_change history via
  // useStageChangeHistory — a dedicated, slim query (just the stage-change
  // rows, no SMS/call/note bodies) rather than the full useActivityFeed
  // used elsewhere on this page, which for an account with a large SMS
  // volume is genuinely large and made this one chart slow to load for no
  // reason it actually needed that data. A lead that has since fallen
  // through to Dead still correctly counts on the months it really was in
  // the contract track, and correctly stops counting once it left. Only
  // leads with an assignment fee actually entered contribute anything.
  //
  // Sampled once per calendar month (month-end snapshot, or "right now" for
  // the current still-in-progress month) rather than daily — a deal
  // pipeline that moves a handful of times a month reads as a meaningful
  // trend over, say, a year of months; the same data plotted daily is
  // mostly flat stretches with no room to show more than a few weeks at
  // once. Fixed 12-month trailing window, independent of the page's own
  // date-range filter (same reasoning as activityRange elsewhere on this
  // page — a long-horizon trend chart shouldn't collapse to a single point
  // just because someone picked "Today" up top).
  const REVENUE_TREND_MONTHS = 12;
  const revenueInPipelineTrend = useMemo(() => {
    const CONTRACT_PLUS_STAGES = new Set(['contract', 'inspection_walkthrough', 'in_title', 'closed']);
    const CLOSED_STAGE = 'closed';

    const transitionsByLead = new Map<string, Array<{ at: number; to: string }>>();
    for (const r of stageChangeHistory) {
      const arr = transitionsByLead.get(r.leadId) ?? [];
      arr.push({ at: new Date(r.createdAt).getTime(), to: r.to });
      transitionsByLead.set(r.leadId, arr);
    }
    for (const arr of transitionsByLead.values()) arr.sort((a, b) => a.at - b.at);

    const everUnderContractIds = new Set<string>();
    for (const [leadId, arr] of transitionsByLead) {
      if (arr.some((t) => t.to === 'contract')) everUnderContractIds.add(leadId);
    }
    // useStageChangeHistory covers full history (unlike useActivityFeed,
    // which is bounded to this year), but a lead can still be missing its
    // own history row in edge cases (e.g. created directly into Contract, In
    // Title, or Closed pre-dating the stage_change trigger) — falls back to
    // "currently somewhere in the contract track" so at least the
    // present-day number stays correct either way.
    const relevantLeads = leads.filter(
      (l) => (everUnderContractIds.has(l.id) || CONTRACT_PLUS_STAGES.has(l.stage)) && l.assignmentFee,
    );

    function stageAsOf(leadId: string, atMs: number): string {
      const arr = transitionsByLead.get(leadId);
      if (!arr) {
        const current = relevantLeads.find((l) => l.id === leadId);
        return current && CONTRACT_PLUS_STAGES.has(current.stage) ? current.stage : 'new';
      }
      let stage = 'new';
      for (const t of arr) {
        if (t.at > atMs) break;
        stage = t.to;
      }
      return stage;
    }

    const months: Array<{ iso: string; label: string; expected: number; actual: number }> = [];
    const today = new Date();
    for (let i = REVENUE_TREND_MONTHS - 1; i >= 0; i--) {
      const monthStart = new Date(today.getFullYear(), today.getMonth() - i, 1);
      // The current, still-in-progress month is sampled "right now" rather
      // than at its (future) month-end, so this month's point always
      // reflects where the pipeline actually stands today.
      const snapshotAt = i === 0 ? today : new Date(today.getFullYear(), today.getMonth() - i + 1, 0, 23, 59, 59, 999);
      let expected = 0;
      let actual = 0;
      for (const l of relevantLeads) {
        const stage = stageAsOf(l.id, snapshotAt.getTime());
        if (CONTRACT_PLUS_STAGES.has(stage)) expected += l.assignmentFee ?? 0;
        if (stage === CLOSED_STAGE) actual += l.assignmentFee ?? 0;
      }
      months.push({
        iso: localIsoDate(monthStart),
        label: monthStart.toLocaleDateString([], { month: 'short' }),
        expected,
        actual,
      });
    }
    return months;
  }, [leads, stageChangeHistory]);

  // "Revenue this month" hero card — reuses revenueInPipelineTrend's own
  // real monthly .actual series (realized/Closed revenue only) rather than
  // a separate computation, so the hero card and the Revenue chart below it
  // can never disagree.
  const revenueCard = useMemo(() => {
    const series = revenueInPipelineTrend.map((m) => m.actual);
    const value = series.length ? series[series.length - 1] : 0;
    const prior = series.length > 1 ? series[series.length - 2] : 0;
    const trendPct = prior > 0 ? ((value - prior) / prior) * 100 : value > 0 ? 100 : 0;
    return { value, trendPct, series: series.slice(-6) };
  }, [revenueInPipelineTrend]);

  // Delivery rate = delivered / sent, reply rate = replies / delivered —
  // Zoom's own definitions, matched against Zoom's own "SMS Campaign" usage
  // report (Reports > Usage Reports > Phone Numbers > SMS Campaign). Every
  // One aggregate total for the whole selected range — not a day-by-day
  // trend — matching Zoom's own "SMS Campaigns" usage report, which is
  // itself one summary row per range, not a daily chart. Counts come from
  // smsDeliveryLog, synced from Zoom's real per-message sms_charges report,
  // with buyer conversations stripped out first (send-buyer-sms rides the
  // exact same shared Zoom numbers as send-sms, so without this a cash-buyer
  // thread would inflate "replies").
  //
  // The cutoff below is deliberately in UTC, not the browser's local time —
  // Zoom's own report windows ("From ... To ...") are UTC. Bucketing "Today"
  // in Pakistan time (5 hours ahead) pulled in a different, incomplete slice
  // of the day and produced numbers nowhere close to Zoom's own report
  // (confirmed by matching Zoom's exact totals — 366 sent / 156 delivered /
  // 1 reply / 42.62% / 0.64% — once the boundary switched to UTC).
  const smsCampaignStats = useMemo(() => {
    const now = new Date();
    let cutoff: Date | null;
    switch (smsRange) {
      case '1d':
        cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        break;
      case '7d':
        cutoff = new Date(now.getTime() - 7 * 86_400_000);
        break;
      case '30d':
        cutoff = new Date(now.getTime() - 30 * 86_400_000);
        break;
      case '90d':
        cutoff = new Date(now.getTime() - 90 * 86_400_000);
        break;
      case 'all':
        cutoff = null;
        break;
    }
    let sent = 0;
    let delivered = 0;
    let failed = 0;
    let replies = 0;
    smsDeliveryLog.forEach((r) => {
      const counterparty = r.counterpartyNumber?.replace(/[^0-9]/g, '').slice(-10);
      if (counterparty && buyerPhones.has(counterparty)) return;
      if (cutoff && new Date(r.occurredAt) < cutoff) return;
      if (r.direction === 'Out') {
        sent++;
        if (r.deliveryStatus === 'delivered') delivered++;
        else if (r.deliveryStatus === 'failed to deliver') failed++;
      } else {
        replies++;
      }
    });
    return {
      sent,
      delivered,
      failed,
      replies,
      deliveryRate: sent > 0 ? (delivered / sent) * 100 : null,
      failedRate: sent > 0 ? (failed / sent) * 100 : null,
      replyRate: delivered > 0 ? (replies / delivered) * 100 : null,
    };
  }, [smsDeliveryLog, buyerPhones, smsRange]);

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

  const maxTag = Math.max(...stats.tagCounts.map((x) => x.count), 1);
  // Donut-chart segments for the Pipeline tag breakdown — top 7 tags by
  // real count (already sorted, see stats.tagCounts), the rest folded into
  // one "Other" slice rather than cramming an unreadable 15-slice donut.
  const tagDonutSegments = (() => {
    const top = stats.tagCounts.slice(0, 7).map((t) => ({ label: t.tag.name, count: t.count, color: t.tag.colorText }));
    const restCount = stats.tagCounts.slice(7).reduce((sum, t) => sum + t.count, 0);
    return restCount > 0 ? [...top, { label: 'Other', count: restCount, color: '#5B6275' }] : top;
  })();
  const taggedLeadsTotal = stats.tagCounts.reduce((sum, t) => sum + t.count, 0);

  const [firstName] = (profile?.fullName ?? '').split(' ');
  const monthRangeLabel = (() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${fmt(start)} – ${fmt(end)}`;
  })();

  return (
    <div>
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text">
            {heading === 'Dashboard' && firstName ? `${timeOfDayGreeting()}, ${firstName}` : heading}
          </h1>
          <p className="mt-1 text-sm text-text-3">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <label className="flex min-h-[42px] items-center gap-2 rounded-xl border border-border bg-surface px-3.5 text-text-3">
            <Search size={16} className="shrink-0" />
            <span className="sr-only">Search leads, addresses…</span>
            <input
              type="search"
              placeholder="Search leads, addresses…"
              className="w-[180px] border-0 bg-transparent text-sm text-text outline-none placeholder:text-text-3"
              onKeyDown={(e) => {
                if (e.key === 'Enter') navigate('/leads');
              }}
            />
          </label>
          <span
            className="flex min-h-[42px] items-center gap-2 rounded-xl border border-border bg-surface px-3.5 text-sm font-medium text-text"
            title="Current month"
          >
            <CalendarDays size={16} className="text-text-3" />
            {monthRangeLabel}
          </span>
          <button
            type="button"
            onClick={() => navigate('/notifications')}
            aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} new` : 'Notifications'}
            className="relative flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-text-2"
          >
            <Bell size={18} />
            {unreadCount > 0 && <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-danger ring-2 ring-surface" />}
          </button>
          <button
            type="button"
            onClick={() => navigate('/leads')}
            className="flex min-h-[42px] items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover"
          >
            <Plus size={14} strokeWidth={2.5} /> New lead
          </button>
        </div>
      </header>

      {leads.length === 0 ? (
        <div className="card text-center text-text-3">Add some leads to see stats here.</div>
      ) : (
        <div className="space-y-6">
          <div>
            <SectionLabel>Overview</SectionLabel>
            <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <HeroStatCard
                icon={DollarSign}
                label="Revenue this month"
                value={revenueCard.value}
                formatValue={money}
                trendPct={revenueCard.trendPct}
                series={revenueCard.series}
                sub="vs last month, closed"
                color="#6E7BFF"
              />
              <HeroStatCard
                icon={Users}
                label="New leads"
                value={heroMetrics.newLeads.value}
                trendPct={heroMetrics.newLeads.trendPct}
                series={heroMetrics.newLeads.series}
                sub="last 4 weeks"
                color="#3DD6B5"
              />
              <HeroStatCard
                icon={FileSignature}
                label="Under contract"
                value={heroMetrics.underContract.value}
                valueSuffix="deals"
                trendPct={heroMetrics.underContract.trendPct}
                series={heroMetrics.underContract.series}
                sub={`${money(heroMetrics.underContract.fees)} in fees`}
                color="#FFB547"
              />
              <HeroStatCard
                icon={Handshake}
                label="In negotiation"
                value={heroMetrics.negotiation.value}
                trendPct={heroMetrics.negotiation.trendPct}
                series={heroMetrics.negotiation.series}
                sub="live right now"
                color="#5AB8FF"
              />
            </div>
            {showSmsStats ? (
              <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-2">
                <div className="card chart-layer flex h-full flex-col">
                  <CardHeader
                    icon={DollarSign}
                    title="Revenue: Expected vs Actual"
                    tone="accent"
                    sub="Expected = fee across Contract, In Title, or Closed · Actual = fee only once Closed"
                  />
                  <Suspense fallback={<div className="mt-3 flex flex-1 items-center justify-center text-[13px] text-text-3">Loading chart…</div>}>
                    <div className="mt-3 flex-1">
                      <RevenueInPipelineChart data={revenueInPipelineTrend} />
                    </div>
                  </Suspense>
                </div>

                <div className="card flex h-full flex-col">
                  {/* One anchor number, set large in the data-tool mono
                      face, with nothing competing for attention around it —
                      the rest of the row's metrics follow as a quiet,
                      unboxed list rather than each getting its own
                      icon-badge card. A dozen identically-styled tiles in a
                      grid is the single most recognizable "generated
                      dashboard" pattern there is; one real headline number
                      plus a plain ledger underneath reads like an actual
                      product instead. */}
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Qualified Leads</div>
                  <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                    <span className="font-mono text-[34px] font-semibold leading-none tracking-tight text-primary">
                      {stats.qualified.toLocaleString()}
                    </span>
                    <span className="text-[13px] text-text-3">{stats.qualifiedRate}% of contacted</span>
                  </div>

                  <div className="mt-5 grid flex-1 grid-cols-2 gap-x-5 gap-y-4 border-t border-border pt-4">
                    {(
                      [
                        { label: 'Total SMS', value: stats.totalSms.toLocaleString(), sub: `${stats.sentInRange.toLocaleString()} out / ${stats.repliesInRange.toLocaleString()} in` },
                        { label: 'Outgoing SMS', value: stats.sentInRange.toLocaleString(), sub: `${stats.sentToday} today` },
                        { label: 'Incoming SMS', value: stats.repliesInRange.toLocaleString(), sub: `${stats.responseRate}% response rate`, color: '#0891b2' },
                        { label: 'AI Replies', value: stats.aiRepliesSent.toLocaleString(), sub: 'no human touch' },
                        { label: 'AI Qualified Leads', value: stats.aiQualifiedCount.toLocaleString(), sub: `${stats.qualifiedRate}% of contacted` },
                        { label: 'Total Contracts', value: stats.contracts.toLocaleString(), sub: `${stats.contractRate}% of qualified`, color: '#10b981' },
                        {
                          label: 'Total Calls',
                          value: stats.totalCalls.toLocaleString(),
                          sub: stats.callsOffProcess > 0 ? `${stats.callsOffProcess} off-process` : 'all to qualified',
                          color: stats.callsOffProcess > 0 ? '#f59e0b' : undefined,
                        },
                        { label: 'Opted Out / DNC', value: stats.optedOut.toLocaleString(), sub: `${stats.optOutRate}% of contacted`, color: '#ef4444' },
                      ] as Array<{ label: string; value: string; sub: string; color?: string }>
                    ).map((s) => (
                      <div key={s.label} className="min-w-0">
                        <div className="truncate text-[10.5px] font-semibold uppercase tracking-wide text-text-3">{s.label}</div>
                        <div
                          className="mt-0.5 font-mono text-[19px] font-semibold leading-tight tabular-nums text-text"
                          style={s.color ? { color: s.color } : undefined}
                        >
                          {s.value}
                        </div>
                        <div className="truncate text-[11px] text-text-3">{s.sub}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="card">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Qualified Leads</div>
                <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                  <span className="font-mono text-[34px] font-semibold leading-none tracking-tight text-primary">
                    {stats.qualified.toLocaleString()}
                  </span>
                  <span className="text-[13px] text-text-3">{stats.qualifiedRate}% of contacted</span>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 border-t border-border pt-4 sm:grid-cols-3 lg:grid-cols-5">
                  {(
                    [
                      { label: 'Total Leads', value: totalLeadsCount.toLocaleString(), sub: `${stats.qualified} qualified` },
                      { label: 'Contracts', value: stats.contracts.toLocaleString(), sub: `${stats.contractRate}% of qualified`, color: '#10b981' },
                      { label: 'Calls Made', value: calls.length.toLocaleString(), sub: `out of ${totalLeadsCount} leads` },
                      { label: 'Total Sessions', value: stats.totalSessions.toLocaleString(), sub: 'calling sessions run' },
                      { label: 'Calls Today', value: stats.callsToday.toLocaleString(), sub: 'logged today' },
                      { label: 'Pickup Ratio', value: String(stats.pickupRatio ?? '—'), sub: 'calls per real outcome' },
                      { label: 'Qualifying Ratio', value: `${stats.qualifyingRate}%`, sub: 'of calls end Qualified' },
                      { label: 'Voicemail Ratio', value: `${stats.voicemailRate}%`, sub: 'of calls end Voicemail' },
                      { label: 'Dead Ratio', value: `${stats.deadRate}%`, sub: 'of calls end Dead/Declined', color: '#ef4444' },
                      { label: 'Opted Out / DNC', value: stats.optedOut.toLocaleString(), sub: `${stats.optOutRate}% of contacted`, color: '#ef4444' },
                    ] as Array<{ label: string; value: string; sub: string; color?: string }>
                  ).map((s) => (
                    <div key={s.label} className="min-w-0">
                      <div className="truncate text-[10.5px] font-semibold uppercase tracking-wide text-text-3">{s.label}</div>
                      <div
                        className="mt-0.5 font-mono text-[19px] font-semibold leading-tight tabular-nums text-text"
                        style={s.color ? { color: s.color } : undefined}
                      >
                        {s.value}
                      </div>
                      <div className="truncate text-[11px] text-text-3">{s.sub}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

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
                  <div className="flex items-start justify-between gap-3">
                    <CardHeader icon={Target} title="Sales funnel efficiency" sub="contact → qualify → contract → close" />
                    <span className="shrink-0 rounded-full bg-primary-dim px-2.5 py-1 text-xs font-semibold text-primary-text">
                      {funnelEfficiency.closeRate.toFixed(1)}% close
                    </span>
                  </div>
                  <div className="mt-4 flex flex-col gap-1.5">
                    {funnel.stages.map((s, i) => {
                      const first = funnel.stages[0]?.count ?? 0;
                      const widthPct = first > 0 ? Math.max(16, (s.count / first) * 100) : 16;
                      const prev = i > 0 ? funnel.stages[i - 1] : null;
                      const stageRate = prev && prev.count > 0 ? Math.round((s.count / prev.count) * 100) : null;
                      const isLeak = biggestLeak?.to === s.label;
                      return (
                        <div
                          key={s.key}
                          className="flex h-[38px] items-center justify-between rounded-[10px] px-3.5 text-[13.5px] font-semibold text-white"
                          style={{
                            width: `${widthPct}%`,
                            marginInline: 'auto',
                            background: s.color,
                            outline: isLeak ? '2px solid rgb(var(--color-danger))' : undefined,
                            outlineOffset: isLeak ? '-2px' : undefined,
                          }}
                        >
                          <span className="truncate">{s.label}</span>
                          <span className="shrink-0 font-mono tabular-nums">
                            {s.count.toLocaleString()}
                            {stageRate != null && <span className="ml-1.5 font-sans font-medium opacity-75">{stageRate}%</span>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {biggestLeak && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl bg-danger-dim px-3 py-2.5 text-[13px] leading-snug text-danger">
                      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                      <span>
                        Biggest leak: only {Math.round(biggestLeak.rate * 100)}% of {biggestLeak.from.toLowerCase()} leads reach {biggestLeak.to.toLowerCase()}.
                      </span>
                    </div>
                  )}
                </div>

                <div className="card">
                  <CardHeader icon={Timer} title="Deal velocity" sub="avg. days between milestones, this year" tone="info" />
                  {(() => {
                    const velocityColors = ['#C3C9FF', '#8B96FF', '#5A66E0', '#363F90'];
                    const totalDays = dealVelocity.reduce((sum, v) => sum + (v.avgDays ?? 0), 0);
                    return (
                      <>
                        <div className="mt-2.5 flex items-baseline gap-1.5">
                          <span className="font-mono text-[32px] font-bold leading-none tracking-tight text-text">
                            {totalDays > 0 ? totalDays.toFixed(1) : '—'}
                          </span>
                          <span className="text-[14px] text-text-3">days lead to close</span>
                        </div>
                        {totalDays > 0 && (
                          <div className="mt-3 flex h-2.5 gap-1" aria-hidden="true">
                            {dealVelocity.map((v, i) => (
                              <div
                                key={v.toLabel}
                                className="rounded-full"
                                style={{ flex: `${Math.max(v.avgDays ?? 0, 0.3)} 1 0`, background: velocityColors[i % velocityColors.length] }}
                              />
                            ))}
                          </div>
                        )}
                        <div className="mt-4 flex flex-col gap-2.5 text-[13px]">
                          {dealVelocity.map((v, i) => (
                            <div key={v.toLabel} className="flex items-center gap-2.5">
                              <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: velocityColors[i % velocityColors.length] }} />
                              <span className="text-text-2">
                                {v.fromLabel} → {v.toLabel}
                              </span>
                              <span className="ml-auto shrink-0 font-mono font-semibold text-text">
                                {v.avgDays !== null ? `${v.avgDays.toFixed(1)}d` : '—'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    );
                  })()}
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
            <SectionLabel>Pipeline</SectionLabel>
            <div className="space-y-3">
              {showSmsStats && (
                <div className="card chart-layer">
                  <CardHeader
                    icon={Gauge}
                    title="Pipeline"
                    sub={
                      leadsErrored
                        ? "Couldn't refresh — showing the last data that loaded"
                        : leadsFetching
                          ? 'live headcount — checking for changes…'
                          : 'live headcount — matches the Kanban board'
                    }
                  />
                  <Suspense fallback={<div className="flex h-[220px] items-center justify-center text-[13px] text-text-3">Loading funnel…</div>}>
                    <div className="mt-3">
                      <PipelineFunnel stages={funnel.stages} offFunnel={funnel.offFunnel} totalLeads={funnel.totalLeads} coldCount={funnel.coldCount} />
                    </div>
                  </Suspense>
                </div>
              )}

              <div className="card">
                <CardHeader icon={TagsIcon} title="Pipeline tag breakdown" tone="accent" />
                <div className="mt-3">
                  {stats.tagCounts.length === 0 ? (
                    <div className="text-[13px] text-text-3">No tagged leads yet.</div>
                  ) : showSmsStats ? (
                    <div className="flex flex-wrap items-center gap-5">
                      <DonutChart segments={tagDonutSegments} total={taggedLeadsTotal} centerLabel="active leads" />
                      <div className="flex min-w-[160px] flex-1 flex-col gap-2 text-[13px]">
                        {tagDonutSegments.map((s) => (
                          <div key={s.label} className="flex items-center gap-2">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
                            <span className="truncate text-text-2">{s.label}</span>
                            <span className="ml-auto shrink-0 font-mono font-semibold text-text">{s.count.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div>
                      {stats.tagCounts.map(({ tag, count }) => (
                        <BarRow key={tag.id} label={tag.name} count={count} max={maxTag} color={tag.colorText} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div>
            <SectionLabel>Performance</SectionLabel>
            <div className="space-y-3">
              {showSmsStats && (
                <div className="card chart-layer">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <CardHeader
                      icon={Waypoints}
                      title="Pipeline Activity"
                      sub={`SMS sent and replies, newly qualified as bubbles · ${SMS_RANGE_OPTIONS.find((r) => r.key === activityRange)?.label}`}
                    />
                    <div className="flex shrink-0 gap-1 rounded-lg border border-border-2 bg-surface-3 p-0.5">
                      {SMS_RANGE_OPTIONS.map((r) => (
                        <button
                          key={r.key}
                          onClick={() => setActivityRange(r.key)}
                          className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                            activityRange === r.key ? 'bg-surface text-text shadow-sm' : 'text-text-3 hover:text-text-2'
                          }`}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Suspense fallback={<div className="flex h-[280px] items-center justify-center text-[13px] text-text-3">Loading chart…</div>}>
                    <div className="mt-3">
                      <PipelineActivityChart data={activityTrend} />
                    </div>
                  </Suspense>
                </div>
              )}

              {showSmsStats && (
                <div className="card">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <CardHeader
                      icon={TrendingUp}
                      title="SMS Delivery & Reply Rate"
                      sub="Real delivery status synced from Zoom, buyer conversations excluded"
                    />
                    <div className="flex shrink-0 gap-1 rounded-lg border border-border-2 bg-surface-3 p-0.5">
                      {SMS_RANGE_OPTIONS.map((r) => (
                        <button
                          key={r.key}
                          onClick={() => setSmsRange(r.key)}
                          className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                            smsRange === r.key ? 'bg-surface text-text shadow-sm' : 'text-text-3 hover:text-text-2'
                          }`}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-5">
                    <RadialGauge pct={smsCampaignStats.deliveryRate ?? 0} size={110} strokeWidth={11} color="#3DD6B5" label="Delivered" centered />
                    <div className="flex flex-1 flex-col gap-0.5">
                      <span className="font-mono text-2xl font-bold text-text">{smsCampaignStats.sent.toLocaleString()}</span>
                      <span className="text-[13px] text-text-3">texts sent</span>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-col gap-3 text-[13.5px]">
                    <div>
                      <div className="flex justify-between">
                        <span className="text-text-2">Reply rate</span>
                        <span className="font-mono font-semibold text-primary-text">
                          {smsCampaignStats.replyRate !== null ? `${smsCampaignStats.replyRate.toFixed(1)}%` : '—'}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-surface-3">
                        <div
                          className="h-1.5 rounded-full bg-primary"
                          style={{ width: `${Math.min(((smsCampaignStats.replyRate ?? 0) / 20) * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between">
                        <span className="text-text-2">Failed</span>
                        <span className="font-mono font-semibold text-danger">
                          {smsCampaignStats.failedRate !== null ? `${smsCampaignStats.failedRate.toFixed(1)}%` : '—'}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-surface-3">
                        <div
                          className="h-1.5 rounded-full bg-danger"
                          style={{ width: `${Math.min(((smsCampaignStats.failedRate ?? 0) / 20) * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="mt-2.5 text-[11.5px] text-text-3">Bars scaled to a 20% ceiling so small rates stay readable.</div>
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

          {showSmsStats && (
            <div>
              <SectionLabel>Marketing</SectionLabel>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="card">
                  {(() => {
                    const dailyMax = Math.max(...dailySmsVolume.map((d) => d.count), 1);
                    const dailyAvg = dailySmsVolume.length
                      ? Math.round(dailySmsVolume.reduce((s, d) => s + d.count, 0) / dailySmsVolume.length)
                      : 0;
                    const peakIdx = dailySmsVolume.reduce((best, d, i) => (d.count > dailySmsVolume[best].count ? i : best), 0);
                    return (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h2 className="text-[16px] font-bold text-text">Texts sent per day</h2>
                            <p className="mt-1 text-[13px] text-text-3">Last 14 days</p>
                          </div>
                          <div className="text-right">
                            <div className="font-mono text-xl font-bold text-text">{dailyAvg.toLocaleString()}</div>
                            <div className="text-[12px] text-text-3">daily average</div>
                          </div>
                        </div>
                        <div className="mt-4 flex items-stretch gap-1" style={{ height: 150 }}>
                          {dailySmsVolume.map((d, i) => (
                            <div key={d.iso} className="flex flex-1 flex-col items-center gap-1">
                              <div className="relative flex w-full flex-1 items-end rounded-t-sm bg-surface-3">
                                <div
                                  className="w-full rounded-t-sm"
                                  style={{
                                    height: `${Math.max((d.count / dailyMax) * 100, d.count > 0 ? 4 : 1)}%`,
                                    background: i === peakIdx ? '#6E7BFF' : '#2C3354',
                                  }}
                                  title={`${d.label}: ${d.count} text${d.count === 1 ? '' : 's'}`}
                                />
                              </div>
                              <div className={cn('text-[10px]', i === peakIdx ? 'font-semibold text-primary-text' : 'text-text-3')}>{d.label}</div>
                            </div>
                          ))}
                        </div>
                      </>
                    );
                  })()}
                </div>

                <div className="card">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="text-[16px] font-bold text-text">SMS activity</h2>
                      <p className="mt-1 text-[13px] text-text-3">New leads per week, last 12 weeks</p>
                    </div>
                    {(() => {
                      const total = leadVolumeTrend.reduce((s, w) => s + w.count, 0);
                      const half = Math.floor(leadVolumeTrend.length / 2) || 1;
                      const earlier = leadVolumeTrend.slice(0, half).reduce((s, w) => s + w.count, 0);
                      const recent = leadVolumeTrend.slice(half).reduce((s, w) => s + w.count, 0);
                      const trendPct = earlier > 0 ? ((recent - earlier) / earlier) * 100 : recent > 0 ? 100 : 0;
                      const up = trendPct >= 0;
                      return (
                        <div className="text-right">
                          <div className="font-mono text-xl font-bold text-text">{total.toLocaleString()}</div>
                          <span
                            className={cn(
                              'mt-0.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-[2px] text-[11px] font-semibold',
                              up ? 'bg-success-dim text-success' : 'bg-danger-dim text-danger',
                            )}
                          >
                            {up ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                            {Math.abs(trendPct).toFixed(1)}%
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                  <div className="mt-4">
                    <AreaTrendChart points={leadVolumeTrend} color="#3DD6B5" />
                  </div>
                </div>
              </div>

              <div className="card chart-layer mt-3">
                <CardHeader
                  icon={MapIcon}
                  title="City Performance"
                  sub="States with 300+ contacted leads, scored by contracts + qualified leads + replies — click a state, then a city, to drill down to zip codes"
                  tone="accent"
                />
                <Suspense fallback={<div className="mt-3 flex h-96 items-center justify-center text-[13px] text-text-3">Loading map…</div>}>
                  <div className="mt-3">
                    <CityPerformanceMap states={stateStats} />
                  </div>
                </Suspense>
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
  return <DashboardView userId={userId} profile={profile} showSmsStats={profile?.role === 'admin'} />;
}
