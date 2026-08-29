import { lazy, Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  Bot,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  DollarSign,
  FileSignature,
  Flame,
  Gauge,
  Map as MapIcon,
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
import { useActivityFeed, useStageChangeHistory } from '@/hooks/useActivities';
import { useTags } from '@/hooks/useTags';
import { useSendLog, useInboundMessages, useSmsDeliveryLog, useCashBuyerPhones } from '@/hooks/useSmsStats';
import { useAuth } from '@/contexts/AuthContext';
import { STAGE_CONFIG, STAGE_ORDER, type LeadStage, type Profile } from '@/types/domain';
import { localIsoDate } from '@/lib/utils';
import { CalendarStrip } from '@/components/dashboard/CalendarStrip';
import { RANGE_OPTIONS, rangeCutoff, type DateRange } from '@/lib/dateRange';
import { CardHeader, SectionLabel } from '@/components/ui/CardHeader';
import { RadialGauge } from '@/components/ui/RadialGauge';
import { useTeamMembers } from '@/hooks/useTeam';
import { useMarketingSpend } from '@/hooks/useMarketingSpend';
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
  // Every real call site passes an explicit color; this fallback only
  // exists so a future one that doesn't still gets a color with real
  // contrast against both a light card and a dark one, instead of a
  // near-black navy that would vanish on a dark background.
  const c = color ?? '#1568A8';
  if (hero) {
    return (
      <div
        className={`rounded-lg shadow-card transition-transform hover:-translate-y-0.5 hover:shadow-card-hover ${compact ? 'p-2.5' : 'p-4'}`}
        style={{ background: c }}
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
  return (
    <div className={`card transition-transform hover:-translate-y-0.5 hover:shadow-card-hover ${compact ? '!p-2.5' : '!p-4'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className={`font-semibold uppercase tracking-wide text-text-3 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>{label}</div>
        {Icon && (
          <span
            className={`flex shrink-0 items-center justify-center rounded-md ${compact ? 'h-6 w-6' : 'h-7 w-7'}`}
            style={{ background: `${c}17`, color: c }}
          >
            <Icon size={compact ? 12 : 14} />
          </span>
        )}
      </div>
      <div className={`font-mono font-semibold tabular-nums ${compact ? 'mt-1 text-lg' : 'mt-2 text-2xl'}`} style={{ color: c }}>
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
  const { data: stageChangeHistory = [] } = useStageChangeHistory(userId);
  const { data: tags = [] } = useTags(userId);
  const { data: sendLog = [] } = useSendLog(showSmsStats);
  const { data: inboundMessages = [] } = useInboundMessages(showSmsStats);
  const { data: smsDeliveryLog = [] } = useSmsDeliveryLog(showSmsStats);
  const { data: buyerPhones = new Set<string>() } = useCashBuyerPhones(showSmsStats);
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

  // The SMS Delivery & Reply Rate card gets its own timeline, independent of
  // the page-wide control above — Zoom's own report is checked at whatever
  // window someone actually wants (a single bad day, this week, this
  // quarter), not locked to the same range as every other card.
  const [smsRange, setSmsRange] = useState<SmsRangeKey>('7d');

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

    const MAP_QUALIFIED_STAGES: LeadStage[] = ['initial_contact', 'followup', 'negotiation', 'contract', 'in_title', 'closed'];
    const MAP_CONTRACT_STAGES: LeadStage[] = ['contract', 'in_title', 'closed'];

    interface Bucket {
      total: number;
      qualified: number;
      contracts: number;
      leadIds: string[];
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
      entry.total++;
      entry.leadIds.push(l.id);
      if (isQualified) entry.qualified++;
      if (isContract) entry.contracts++;

      let stateEntry = byState.get(stateKey);
      if (!stateEntry) {
        stateEntry = { total: 0, qualified: 0, contracts: 0, leadIds: [] };
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
          zg = { total: 0, qualified: 0, contracts: 0, leadIds: [] };
          entry.zipGroups.set(zip5, zg);
        }
        zg.total++;
        zg.leadIds.push(l.id);
        if (isQualified) zg.qualified++;
        if (isContract) zg.contracts++;
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

  // "Revenue in pipeline" = total assignment fee across every lead
  // currently Under Contract — but "currently" only tells you today's
  // number, and the point of a trend chart is the days before today too.
  // Reconstructed from each lead's real stage_change history via
  // useStageChangeHistory — a dedicated, slim query (just the stage-change
  // rows, no SMS/call/note bodies) rather than the full useActivityFeed
  // used elsewhere on this page, which for an account with a large SMS
  // volume is genuinely large and made this one chart slow to load for no
  // reason it actually needed that data. A lead that has since moved to In
  // Title/Closed, or fallen through to Dead, still correctly counts on the
  // days it really was under contract, and correctly stops counting once
  // it left. Only leads with an assignment fee actually entered contribute
  // anything.
  const revenueInPipelineTrend = useMemo(() => {
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
    // own history row in edge cases (e.g. created directly into Contract
    // pre-dating the stage_change trigger) — falls back to "currently Under
    // Contract" so at least the present-day number stays correct either way.
    const relevantLeads = leads.filter(
      (l) => (everUnderContractIds.has(l.id) || l.stage === 'contract') && l.assignmentFee,
    );

    function stageAsOf(leadId: string, atMs: number): string {
      const arr = transitionsByLead.get(leadId);
      if (!arr) return relevantLeads.some((l) => l.id === leadId && l.stage === 'contract') ? 'contract' : 'new';
      let stage = 'new';
      for (const t of arr) {
        if (t.at > atMs) break;
        stage = t.to;
      }
      return stage;
    }

    const days: Array<{ iso: string; label: string; revenue: number }> = [];
    const today = new Date();
    for (let i = trendDayCount - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i, 23, 59, 59, 999);
      const revenue = relevantLeads.reduce(
        (sum, l) => sum + (stageAsOf(l.id, d.getTime()) === 'contract' ? l.assignmentFee ?? 0 : 0),
        0,
      );
      days.push({
        iso: localIsoDate(d),
        label: d.toLocaleDateString([], trendDayCount <= 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' }),
        revenue,
      });
    }
    return days;
  }, [leads, stageChangeHistory, trendDayCount]);

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
    let replies = 0;
    smsDeliveryLog.forEach((r) => {
      const counterparty = r.counterpartyNumber?.replace(/[^0-9]/g, '').slice(-10);
      if (counterparty && buyerPhones.has(counterparty)) return;
      if (cutoff && new Date(r.occurredAt) < cutoff) return;
      if (r.direction === 'Out') {
        sent++;
        if (r.deliveryStatus === 'delivered') delivered++;
      } else {
        replies++;
      }
    });
    return {
      sent,
      delivered,
      replies,
      deliveryRate: sent > 0 ? (delivered / sent) * 100 : null,
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
              <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-2">
                <div className="card chart-layer flex h-full flex-col">
                  <CardHeader
                    icon={DollarSign}
                    title="Revenue in Pipeline"
                    tone="accent"
                    sub={`Assignment fee across leads Under Contract · ${rangeLabel}`}
                  />
                  <Suspense fallback={<div className="mt-3 flex flex-1 items-center justify-center text-[13px] text-text-3">Loading chart…</div>}>
                    <div className="mt-3 flex-1">
                      <RevenueInPipelineChart data={revenueInPipelineTrend} />
                    </div>
                  </Suspense>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <StatCard
                    label="Total Leads"
                    value={stats.total.toLocaleString()}
                    sub={`${leads.filter((l) => l.stage === 'new').length} still cold`}
                    color="#0B1E33"
                    icon={Users}
                    hero
                    compact
                  />
                  <StatCard
                    label="Qualified Leads"
                    value={stats.qualified.toLocaleString()}
                    sub={`${stats.qualifiedRate}% of contacted`}
                    color="#1568A8"
                    icon={CheckCircle2}
                    hero
                    compact
                  />
                  <StatCard
                    label="Contracts"
                    value={stats.contracts.toLocaleString()}
                    sub={`${stats.contractRate}% of qualified leads`}
                    color="#10b981"
                    icon={FileSignature}
                    hero
                    compact
                  />
                  <StatCard
                    label="SMS Sent"
                    value={stats.sentInRange.toLocaleString()}
                    sub={`${rangeLabel.toLowerCase()} · ${stats.sentToday} today`}
                    color="#C9A24B"
                    icon={MessageSquare}
                    hero
                    compact
                  />
                  <StatCard
                    label="Replies"
                    value={stats.repliesInRange.toLocaleString()}
                    sub={`${stats.responseRate}% response rate`}
                    color="#22d3ee"
                    icon={Reply}
                    compact
                  />
                  <StatCard
                    label="AI Auto-Replies"
                    value={stats.aiRepliesSent.toLocaleString()}
                    sub="drafted and sent, no human touch"
                    color="#a78bfa"
                    icon={Bot}
                    compact
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
                    compact
                  />
                  <StatCard
                    label="Opted Out / DNC"
                    value={stats.optedOut.toLocaleString()}
                    sub={`${stats.optOutRate}% of contacted`}
                    color="#ef4444"
                    icon={UserX}
                    compact
                  />
                </div>
              </div>
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


          {showSmsStats && (
            <div>
              <SectionLabel>Calendar</SectionLabel>
              <CalendarStrip userId={userId} leads={leads} />
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

              <div className="card">
                <CardHeader icon={TagsIcon} title="Tag Breakdown" tone="accent" />
                <div className="mt-2">
                  {stats.tagCounts.length === 0 ? (
                    <div className="text-[13px] text-text-3">No tagged leads yet.</div>
                  ) : (
                    <div className={showSmsStats ? 'grid grid-cols-1 gap-x-6 sm:grid-cols-2' : undefined}>
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
                  <CardHeader icon={Waypoints} title="Pipeline Activity" sub={`SMS sent and replies, newly qualified as bubbles · ${rangeLabel}`} />
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
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[560px] border-collapse text-left">
                      <thead>
                        <tr className="border-b border-border-2">
                          {['Campaign', 'Total sent', 'Total delivered', 'Total replies', 'Delivery rate', 'Reply rate'].map((h) => (
                            <th key={h} className="whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-3">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="whitespace-nowrap px-3 py-2.5 text-[13px] font-medium text-text">Solution Campaign</td>
                          <td className="px-3 py-2.5 font-mono text-[13px] tabular-nums text-text">{smsCampaignStats.sent.toLocaleString()}</td>
                          <td className="px-3 py-2.5 font-mono text-[13px] tabular-nums text-text">{smsCampaignStats.delivered.toLocaleString()}</td>
                          <td className="px-3 py-2.5 font-mono text-[13px] tabular-nums text-text">{smsCampaignStats.replies.toLocaleString()}</td>
                          <td className="px-3 py-2.5 font-mono text-[13px] font-semibold tabular-nums text-primary">
                            {smsCampaignStats.deliveryRate !== null ? `${smsCampaignStats.deliveryRate.toFixed(2)}%` : '—'}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[13px] font-semibold tabular-nums text-primary">
                            {smsCampaignStats.replyRate !== null ? `${smsCampaignStats.replyRate.toFixed(2)}%` : '—'}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
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
  return <DashboardView userId={userId} profile={profile} allowStartSession showSmsStats={profile?.role === 'admin'} />;
}
