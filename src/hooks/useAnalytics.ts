import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fetchAllPages } from '@/lib/paginate';
import { useAuth } from '@/contexts/AuthContext';
import { useTeamMembers } from '@/hooks/useTeam';
import type { ContractInstance } from '@/hooks/useContractInstances';
import type { LeadStage } from '@/types/domain';
import { normalizeSourceKey } from '@/lib/leadSources';

// Deliberately narrower than the full lead row `useLeads` fetches — analytics
// only ever touches these five columns, and this runs once per team member.
export interface AnalyticsLead {
  id: string;
  source: string | null;
  stage: LeadStage;
  createdAt: string;
  qualifiedAt: string | null;
}

export interface StageChangeEvent {
  leadId: string;
  toStage: string;
  createdAt: string;
}

const FULL_HISTORY_SINCE = '2000-01-01T00:00:00Z';

async function fetchLeadsForUser(userId: string): Promise<AnalyticsLead[]> {
  const rows = await fetchAllPages<any>((from, to) =>
    supabase
      .from('leads')
      .select('id, source, stage, created_at, qualified_at')
      .eq('user_id', userId)
      .range(from, to),
  );
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    stage: r.stage,
    createdAt: r.created_at,
    qualifiedAt: r.qualified_at,
  }));
}

async function fetchStageChangesForUser(userId: string): Promise<StageChangeEvent[]> {
  const rows = await fetchAllPages<any>((from, to) =>
    supabase
      .from('lead_activities')
      .select('lead_id, meta, created_at')
      .eq('user_id', userId)
      .eq('type', 'stage_change')
      .gte('created_at', FULL_HISTORY_SINCE)
      .order('created_at', { ascending: true })
      .range(from, to),
  );
  return rows
    .filter((r) => r.meta?.to)
    .map((r) => ({ leadId: r.lead_id, toStage: r.meta.to as string, createdAt: r.created_at }));
}

/** Every lead across the whole team (the admin's own + everyone they
 * oversee), fanned out one query per member the same way TeamPage's
 * MemberStats does — just combined into one flat array instead of rendered
 * per-member. */
export function useOrgLeads() {
  const { session } = useAuth();
  const { data: members = [] } = useTeamMembers();
  const userIds = useMemo(() => {
    const ids = new Set<string>();
    if (session?.user.id) ids.add(session.user.id);
    for (const m of members) ids.add(m.memberId);
    return Array.from(ids);
  }, [session?.user.id, members]);

  const results = useQueries({
    queries: userIds.map((id) => ({
      queryKey: ['analytics_leads', id],
      queryFn: () => fetchLeadsForUser(id),
      enabled: !!id,
      staleTime: 60_000,
    })),
  });

  const isLoading = userIds.length === 0 || results.some((r) => r.isLoading);
  const data = useMemo(() => results.flatMap((r) => r.data ?? []), [results]);
  return { data, isLoading };
}

export function useOrgStageChanges() {
  const { session } = useAuth();
  const { data: members = [] } = useTeamMembers();
  const userIds = useMemo(() => {
    const ids = new Set<string>();
    if (session?.user.id) ids.add(session.user.id);
    for (const m of members) ids.add(m.memberId);
    return Array.from(ids);
  }, [session?.user.id, members]);

  const results = useQueries({
    queries: userIds.map((id) => ({
      queryKey: ['analytics_stage_changes', id],
      queryFn: () => fetchStageChangesForUser(id),
      enabled: !!id,
      staleTime: 60_000,
    })),
  });

  const isLoading = userIds.length === 0 || results.some((r) => r.isLoading);
  const data = useMemo(() => results.flatMap((r) => r.data ?? []), [results]);
  return { data, isLoading };
}

// Mirrors the same set DashboardPage.tsx defines locally — a lead sitting in
// one of these stages has, by definition, been qualified.
const QUALIFIED_PLUS_STAGES: LeadStage[] = ['initial_contact', 'followup', 'negotiation', 'contract'];

export interface SourcePerformanceRow {
  key: string;
  label: string;
  leadCount: number;
  qualifiedCount: number;
  contractsSentCount: number;
  contractsSignedCount: number;
}

export function computeSourcePerformance(leads: AnalyticsLead[], contracts: ContractInstance[]): SourcePerformanceRow[] {
  const sentOrBeyond = new Set(['sent', 'partial', 'signed']);
  const leadIdsWithSent = new Set(contracts.filter((c) => c.leadId && sentOrBeyond.has(c.status)).map((c) => c.leadId!));
  const leadIdsSigned = new Set(contracts.filter((c) => c.leadId && c.status === 'signed').map((c) => c.leadId!));

  const buckets = new Map<string, { label: string; labelCounts: Map<string, number>; rows: AnalyticsLead[] }>();
  for (const lead of leads) {
    const key = normalizeSourceKey(lead.source) || '(unknown)';
    const displayLabel = lead.source?.trim() || 'Unknown';
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { label: displayLabel, labelCounts: new Map(), rows: [] };
      buckets.set(key, bucket);
    }
    bucket.rows.push(lead);
    bucket.labelCounts.set(displayLabel, (bucket.labelCounts.get(displayLabel) ?? 0) + 1);
  }

  const result: SourcePerformanceRow[] = [];
  for (const [key, bucket] of buckets) {
    // Display whichever original casing/spelling was most common for this
    // normalized key, so "cold call" and "Cold Call" merge into one row
    // without losing a sensible label.
    let bestLabel = bucket.label;
    let bestCount = 0;
    for (const [label, count] of bucket.labelCounts) {
      if (count > bestCount) {
        bestLabel = label;
        bestCount = count;
      }
    }
    result.push({
      key,
      label: bestLabel,
      leadCount: bucket.rows.length,
      qualifiedCount: bucket.rows.filter((l) => l.qualifiedAt || QUALIFIED_PLUS_STAGES.includes(l.stage)).length,
      contractsSentCount: bucket.rows.filter((l) => leadIdsWithSent.has(l.id)).length,
      contractsSignedCount: bucket.rows.filter((l) => leadIdsSigned.has(l.id)).length,
    });
  }

  return result.sort((a, b) => b.leadCount - a.leadCount);
}

export interface StageTimingRow {
  stage: LeadStage;
  avgDays: number;
  sampleSize: number;
}

export interface StageTimingResult {
  stages: StageTimingRow[];
  avgDaysToSigned: number | null;
  signedSampleSize: number;
}

/** Walks each lead's stage_change history (created_at treated as the
 * implicit "entered new" event) and measures how long it spent in each
 * stage it has since LEFT — a lead's current stage is still an open stay
 * and doesn't count toward the average. `rangeCutoff` filters by when a
 * stay ENDED, not when it started, so a range picker doesn't clip stays
 * that were already in progress before the window. */
export function computeStageTiming(leads: AnalyticsLead[], events: StageChangeEvent[], contracts: ContractInstance[], rangeCutoff: Date | null): StageTimingResult {
  const eventsByLead = new Map<string, StageChangeEvent[]>();
  for (const e of events) {
    const arr = eventsByLead.get(e.leadId);
    if (arr) arr.push(e);
    else eventsByLead.set(e.leadId, [e]);
  }

  const durationsByStage = new Map<string, number[]>();
  const cutoffMs = rangeCutoff?.getTime() ?? null;

  for (const lead of leads) {
    const leadEvents = eventsByLead.get(lead.id);
    if (!leadEvents || leadEvents.length === 0) continue;

    let stage: string = 'new';
    let enteredAt = new Date(lead.createdAt).getTime();

    for (const event of leadEvents) {
      const exitAt = new Date(event.createdAt).getTime();
      if (cutoffMs === null || exitAt >= cutoffMs) {
        const days = (exitAt - enteredAt) / 86400000;
        if (days >= 0) {
          const arr = durationsByStage.get(stage);
          if (arr) arr.push(days);
          else durationsByStage.set(stage, [days]);
        }
      }
      stage = event.toStage;
      enteredAt = exitAt;
    }
    // The lead's final (current) stage is still an open stay — intentionally
    // not included.
  }

  const stages: StageTimingRow[] = [];
  for (const [stage, durations] of durationsByStage) {
    stages.push({
      stage: stage as LeadStage,
      avgDays: durations.reduce((a, b) => a + b, 0) / durations.length,
      sampleSize: durations.length,
    });
  }

  const leadById = new Map(leads.map((l) => [l.id, l]));
  const signedDurations: number[] = [];
  for (const c of contracts) {
    if (c.status !== 'signed' || !c.leadId || !c.completedAt) continue;
    if (cutoffMs !== null && new Date(c.completedAt).getTime() < cutoffMs) continue;
    const lead = leadById.get(c.leadId);
    if (!lead) continue;
    const days = (new Date(c.completedAt).getTime() - new Date(lead.createdAt).getTime()) / 86400000;
    if (days >= 0) signedDurations.push(days);
  }

  return {
    stages,
    avgDaysToSigned: signedDurations.length ? signedDurations.reduce((a, b) => a + b, 0) / signedDurations.length : null,
    signedSampleSize: signedDurations.length,
  };
}
