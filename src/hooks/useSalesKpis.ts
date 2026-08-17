import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fetchAllPages } from '@/lib/paginate';
import { useAuth } from '@/contexts/AuthContext';
import { useTeamMembers } from '@/hooks/useTeam';
import type { LeadStage } from '@/types/domain';

function useOrgUserIds(): string[] {
  const { session } = useAuth();
  const { data: members = [] } = useTeamMembers();
  return useMemo(() => {
    const ids = new Set<string>();
    if (session?.user.id) ids.add(session.user.id);
    for (const m of members) ids.add(m.memberId);
    return Array.from(ids);
  }, [session?.user.id, members]);
}

export interface KpiLead {
  id: string;
  userId: string;
  stage: LeadStage;
  createdAt: string;
}

async function fetchLeadsForUser(userId: string): Promise<KpiLead[]> {
  const rows = await fetchAllPages<any>((from, to) =>
    supabase.from('leads').select('id, stage, created_at').eq('user_id', userId).range(from, to),
  );
  return rows.map((r) => ({ id: r.id, userId, stage: r.stage, createdAt: r.created_at }));
}

/** Every lead across the whole team (admin's own + everyone they oversee),
 * fanned out one query per member — same shape TeamPage already uses per
 * member, just combined into one flat array instead of rendered per-member.
 * `enabled` mirrors the useSendLog(showSmsStats)-style gate already used
 * elsewhere on this page — these sections are admin-only, so a caller's
 * dashboard never fires the fan-out at all. */
export function useOrgLeads(enabled = true) {
  const userIds = useOrgUserIds();
  const results = useQueries({
    queries: userIds.map((id) => ({
      queryKey: ['kpi_leads', id],
      queryFn: () => fetchLeadsForUser(id),
      enabled: enabled && !!id,
      staleTime: 60_000,
    })),
  });
  const isLoading = enabled && (userIds.length === 0 || results.some((r) => r.isLoading));
  const data = useMemo(() => results.flatMap((r) => r.data ?? []), [results]);
  return { data, isLoading };
}

export interface KpiActivity {
  leadId: string;
  userId: string;
  type: string;
  toStage: string | null;
  createdAt: string;
}

const SINCE = new Date(new Date().getFullYear(), 0, 1).toISOString();

async function fetchActivitiesForUser(userId: string): Promise<KpiActivity[]> {
  const rows = await fetchAllPages<any>((from, to) =>
    supabase
      .from('lead_activities')
      .select('lead_id, type, meta, created_at')
      .eq('user_id', userId)
      .gte('created_at', SINCE)
      .order('created_at', { ascending: true })
      .range(from, to),
  );
  return rows.map((r) => ({ leadId: r.lead_id, userId, type: r.type, toStage: r.meta?.to ?? null, createdAt: r.created_at }));
}

/** Same fan-out shape as useOrgLeads, over this year's lead_activities —
 * powers both call counts (type='call') and stage-timing (type='stage_change')
 * per rep, in one fetch instead of two. */
export function useOrgActivities(enabled = true) {
  const userIds = useOrgUserIds();
  const results = useQueries({
    queries: userIds.map((id) => ({
      queryKey: ['kpi_activities', id],
      queryFn: () => fetchActivitiesForUser(id),
      enabled: enabled && !!id,
      staleTime: 60_000,
    })),
  });
  const isLoading = enabled && (userIds.length === 0 || results.some((r) => r.isLoading));
  const data = useMemo(() => results.flatMap((r) => r.data ?? []), [results]);
  return { data, isLoading };
}

export interface RepStat {
  userId: string;
  name: string;
  calls: number;
  leads: number;
  qualified: number;
  contracts: number;
  qualifyRate: number;
}

const QUALIFIED_PLUS: LeadStage[] = ['initial_contact', 'followup', 'negotiation', 'contract', 'in_title', 'closed'];

/** Calls made, qualify rate, and contracts closed per rep — the
 * accountability view a business with more than one caller actually needs;
 * meaningless for a solo operator, which is why it's only rendered when the
 * team actually has more than one member. */
export function computeRepLeaderboard(
  leads: KpiLead[],
  activities: KpiActivity[],
  members: Array<{ memberId: string; name: string }>,
): RepStat[] {
  const nameById = new Map(members.map((m) => [m.memberId, m.name]));
  const byUser = new Map<string, { leads: KpiLead[]; calls: number }>();
  for (const l of leads) {
    const bucket = byUser.get(l.userId) ?? { leads: [], calls: 0 };
    bucket.leads.push(l);
    byUser.set(l.userId, bucket);
  }
  for (const a of activities) {
    if (a.type !== 'call') continue;
    const bucket = byUser.get(a.userId) ?? { leads: [], calls: 0 };
    bucket.calls++;
    byUser.set(a.userId, bucket);
  }
  const stats: RepStat[] = [];
  for (const [userId, { leads: userLeads, calls }] of byUser) {
    const qualified = userLeads.filter((l) => QUALIFIED_PLUS.includes(l.stage)).length;
    const contracts = userLeads.filter((l) => l.stage === 'contract' || l.stage === 'in_title' || l.stage === 'closed').length;
    stats.push({
      userId,
      name: nameById.get(userId) ?? 'You',
      calls,
      leads: userLeads.length,
      qualified,
      contracts,
      qualifyRate: userLeads.length > 0 ? Math.round((qualified / userLeads.length) * 100) : 0,
    });
  }
  return stats.sort((a, b) => b.contracts - a.contracts || b.calls - a.calls);
}

export interface StageVelocity {
  fromLabel: string;
  toLabel: string;
  avgDays: number | null;
  sampleSize: number;
}

/** Median-ish (mean, in practice close enough at this sample size) days
 * spent between two milestones — walks each lead's real stage_change
 * history rather than assuming a lead moves through every stage in order,
 * since plenty jump straight from Contacted to Qualified. */
export function computeDealVelocity(leads: KpiLead[], activities: KpiActivity[]): StageVelocity[] {
  const eventsByLead = new Map<string, KpiActivity[]>();
  for (const a of activities) {
    if (a.type !== 'stage_change' || !a.toStage) continue;
    const arr = eventsByLead.get(a.leadId);
    if (arr) arr.push(a);
    else eventsByLead.set(a.leadId, [a]);
  }

  // First-reached timestamp per lead for each milestone stage.
  const reachedAt = new Map<string, Map<string, number>>();
  for (const lead of leads) {
    const events = eventsByLead.get(lead.id);
    const map = new Map<string, number>();
    map.set('new', new Date(lead.createdAt).getTime());
    if (events) {
      for (const e of events) {
        const t = new Date(e.createdAt).getTime();
        if (!map.has(e.toStage!)) map.set(e.toStage!, t);
      }
    }
    reachedAt.set(lead.id, map);
  }

  function avgGap(fromStage: string, toStages: string[]): { avgDays: number | null; sampleSize: number } {
    const gaps: number[] = [];
    for (const lead of leads) {
      const map = reachedAt.get(lead.id);
      if (!map) continue;
      const fromT = map.get(fromStage);
      if (fromT === undefined) continue;
      const toT = Math.min(...toStages.map((s) => map.get(s) ?? Infinity));
      if (!Number.isFinite(toT) || toT < fromT) continue;
      gaps.push((toT - fromT) / 86400000);
    }
    return { avgDays: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null, sampleSize: gaps.length };
  }

  const newToQualified = avgGap('new', ['initial_contact', 'followup']);
  const qualifiedToContract = avgGap('followup', ['contract', 'in_title', 'closed']);

  return [
    { fromLabel: 'New Lead', toLabel: 'Qualified', avgDays: newToQualified.avgDays, sampleSize: newToQualified.sampleSize },
    { fromLabel: 'Qualified', toLabel: 'Contract', avgDays: qualifiedToContract.avgDays, sampleSize: qualifiedToContract.sampleSize },
  ];
}
