import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { dbToLead, leadToDbInsert, leadToDbUpdate } from '@/lib/mappers';
import { useAuth } from '@/contexts/AuthContext';
import { fetchAllPages } from '@/lib/paginate';
import type { Lead, LeadStage } from '@/types/domain';

// List views (Kanban, leads table, dashboard) don't render comps or files —
// omitting them cuts payload by ~70% for large accounts.
const LEAD_LIST_SELECT = '*, lead_tags(tag_id)';
// Detail view (lead profile) needs comps and files.
const LEAD_DETAIL_SELECT = '*, lead_tags(tag_id), lead_comps(*), lead_files(*)';

const PAGE = 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Firing 10+ large range requests at once over a real network (as opposed to
// this same call from a Node script hitting the API directly) means any one
// of them dropping — a flaky connection, a proxy hiccup — used to take the
// entire list down with it via Promise.all's all-or-nothing behavior, which
// looked exactly like "all my leads vanished" even though nothing was lost
// server-side. Retrying the one page that failed, instead of the whole
// fetch, fixes that without adding retries every request doesn't need.
async function fetchLeadPage(userId: string, i: number, attempt = 0): Promise<Lead[]> {
  const { data, error } = await supabase
    .from('leads')
    .select(LEAD_LIST_SELECT)
    .eq('user_id', userId)
    .order('lead_num', { ascending: true })
    .range(i * PAGE, i * PAGE + PAGE - 1);
  if (error) {
    if (attempt >= 2) throw error;
    await sleep(400 * (attempt + 1));
    return fetchLeadPage(userId, i, attempt + 1);
  }
  return data.map(dbToLead);
}

/**
 * Fetches every lead for a user. A `head: true` count gives us the page count up
 * front so all pages fire in parallel — the previous serial loop paid one full
 * round-trip per 1000 leads before the next could even start.
 *
 * A large account (10k+ leads) still means 10+ requests each carrying every
 * column on the table, and waiting on all of them together meant the board
 * stayed blank for as long as the single slowest page took — on a
 * bandwidth-constrained connection that's the whole multi-megabyte transfer,
 * not just one page's worth. `onPage` lets the caller paint each page the
 * moment it lands instead of waiting on the rest, so the board becomes
 * usable in roughly 1/Nth the time and keeps filling in from there.
 *
 * A lead inserted between the count and the page reads can be missed until the
 * next refetch; the serial version had the same race and it self-corrects on
 * the next invalidate.
 */
async function fetchLeadsPaged(userId: string, onPage?: (soFar: Lead[]) => void): Promise<Lead[]> {
  const { count, error: countError } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (countError) throw countError;
  if (!count) return [];

  const pageCount = Math.ceil(count / PAGE);
  let all = await fetchLeadPage(userId, 0);
  onPage?.(all);
  if (pageCount === 1) return all;

  // The remaining pages still fire in parallel — updating `all` is a single
  // synchronous statement per page with no `await` inside it, so concurrent
  // resolutions can't interleave and lose one page's rows to another's.
  await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, i) => i + 1).map(async (i) => {
      const page = await fetchLeadPage(userId, i);
      all = [...all, ...page].sort((a, b) => (a.leadNum ?? 0) - (b.leadNum ?? 0));
      onPage?.(all);
    }),
  );

  return all;
}

export function useLeads(targetUserId?: string) {
  const { session } = useAuth();
  const userId = targetUserId ?? session?.user.id;
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['leads', userId],
    queryFn: () => fetchLeadsPaged(userId!, (soFar) => qc.setQueryData(['leads', userId], soFar)),
    enabled: !!userId,
    // The app-wide default (5 min staleTime, 15 min gcTime — see App.tsx) is
    // right for most queries, but this one fetches the whole account (Kanban/
    // Dashboard/etc.) in chunks of 1000 with a visible pop-in as each chunk
    // lands. Sitting on a lead for a few minutes (a call, texting) and coming
    // back to Kanban was enough to go stale and silently re-trigger that
    // whole chunked fetch, or — past 15 min — get garbage-collected and
    // refetch from a blank board. This should only ever run once per app
    // load; every real change already updates the cache directly (see
    // useCreateLead/useUpdateLead/useDeleteLeads/useSetLeadTags below), so
    // there's nothing for a time-based refetch to catch that isn't already
    // covered — except another user's edit, which won't show here until the
    // next full reload (no realtime wired to this query; a deliberate
    // trade-off per the user, not an oversight).
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

const LEADS_PAGE_SIZE = 200;

export interface LeadsPageResult {
  rows: Lead[];
  count: number;
}

/**
 * One page, sorted server-side by pipeline priority (see migration
 * 0125_leads_stage_priority.sql for the tier mapping) rather than creation
 * order, so the leads that matter most land on page 1. `!inner` on the
 * lead_tags embed turns tagFilter into a real join filter instead of just
 * hydrating tags for display.
 */
async function fetchLeadsPage(
  userId: string,
  page: number,
  search: string,
  stageFilter: LeadStage | '',
  tagFilter: string,
): Promise<LeadsPageResult> {
  let query = supabase
    .from('leads')
    .select(tagFilter ? '*, lead_tags!inner(tag_id)' : LEAD_LIST_SELECT, { count: 'exact' })
    .eq('user_id', userId);

  if (stageFilter) query = query.eq('stage', stageFilter);
  if (tagFilter) query = query.eq('lead_tags.tag_id', tagFilter);
  const q = search.trim();
  if (q) {
    const pattern = `%${q}%`;
    query = query.or(`first_name.ilike.${pattern},last_name.ilike.${pattern},phone.ilike.${pattern},address.ilike.${pattern}`);
  }

  const from = (page - 1) * LEADS_PAGE_SIZE;
  const { data, error, count } = await query
    .order('stage_priority', { ascending: true })
    .order('lead_num', { ascending: true })
    .range(from, from + LEADS_PAGE_SIZE - 1);
  if (error) throw error;
  return { rows: (data ?? []).map(dbToLead), count: count ?? 0 };
}

/** Server-side-paginated leads for the Leads table — unlike useLeads() this
 *  never loads more than one page into the browser. Kanban/Dashboard/etc.
 *  keep using useLeads() since they need the full account in memory. */
export function useLeadsPage(
  targetUserId: string | undefined,
  page: number,
  search: string,
  stageFilter: LeadStage | '',
  tagFilter: string,
) {
  const { session } = useAuth();
  const userId = targetUserId ?? session?.user.id;
  return useQuery({
    queryKey: ['leads', 'page', userId, page, search, stageFilter, tagFilter],
    queryFn: () => fetchLeadsPage(userId!, page, search, stageFilter, tagFilter),
    enabled: !!userId,
    placeholderData: keepPreviousData,
  });
}

/** Account-wide lead count, unfiltered — backs the Leads table's "N total"
 *  header, which (unlike the pagination footer) always shows the grand total
 *  regardless of the active search/stage/tag filters. */
export function useLeadsTotalCount(targetUserId?: string) {
  const { session } = useAuth();
  const userId = targetUserId ?? session?.user.id;
  return useQuery({
    queryKey: ['leads', 'count', userId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!userId,
  });
}

export interface LeadStageAndTags {
  id: string;
  leadNum: number | null;
  firstName: string;
  lastName: string;
  stage: LeadStage;
  tagIds: string[];
}

/** Every lead's id/stage/tags (no comps/files/pricing) for DeleteLeadsModal's
 *  "by filter" mode, which needs live per-stage/per-tag counts across the
 *  whole account — something the paginated Leads table no longer holds. */
export function useAllLeadStagesAndTags(targetUserId?: string) {
  const { session } = useAuth();
  const userId = targetUserId ?? session?.user.id;
  return useQuery({
    queryKey: ['leads', 'stagesAndTags', userId],
    queryFn: () =>
      fetchAllPages<any>((from, to) =>
        supabase
          .from('leads')
          .select('id, lead_num, first_name, last_name, stage, lead_tags(tag_id)')
          .eq('user_id', userId)
          .order('lead_num', { ascending: true })
          .range(from, to),
      ).then((rows) =>
        rows.map(
          (r): LeadStageAndTags => ({
            id: r.id,
            leadNum: r.lead_num,
            firstName: r.first_name ?? '',
            lastName: r.last_name ?? '',
            stage: r.stage,
            tagIds: (r.lead_tags ?? []).map((t: any) => t.tag_id),
          }),
        ),
      ),
    enabled: !!userId,
  });
}

export interface ContractLeadSummary {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  finalPrice: number | null;
  askingPrice: number | null;
}

/** Every lead currently in the Contract stage, across the whole team — feeds
 *  Disposition's "assign a deal to this buyer" picker. Deliberately not
 *  scoped to the caller's own leads like useLeads() is: an admin needs to
 *  see every rep's contracted deals, not just their own (same reasoning as
 *  useAllDealPackets in useDealPackets.ts). */
export function useContractStageLeads() {
  return useQuery({
    queryKey: ['leads', 'contract_stage'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('id, first_name, last_name, address, city, state, final_price, asking_price')
        .eq('stage', 'contract')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(
        (r): ContractLeadSummary => ({
          id: r.id,
          name: `${r.first_name} ${r.last_name}`.trim(),
          address: r.address,
          city: r.city,
          state: r.state,
          finalPrice: r.final_price != null ? Number(r.final_price) : null,
          askingPrice: r.asking_price != null ? Number(r.asking_price) : null,
        }),
      );
    },
  });
}

/** Call on hover to warm the cache before navigation. */
export function prefetchLeads(qc: QueryClient, userId: string) {
  return qc.prefetchQuery({
    queryKey: ['leads', userId],
    queryFn: () => fetchLeadsPaged(userId, (soFar) => qc.setQueryData(['leads', userId], soFar)),
    staleTime: 5 * 60_000,
  });
}

export function useLead(id: string | undefined) {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['lead', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('leads').select(LEAD_DETAIL_SELECT).eq('id', id).single();
      if (error) throw error;
      return dbToLead(data);
    },
    // Most navigations to a lead profile come from a page that already loaded
    // the full leads list (Leads table, Kanban, Dashboard), so render from that
    // cache instantly instead of waiting on a fresh network round-trip.
    initialData: () => qc.getQueryData<Lead[]>(['leads', session?.user.id])?.find((l) => l.id === id),
    enabled: !!id,
  });
}

export function useCreateLead() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (lead: Partial<Lead> & { tagIds?: string[] }) => {
      const { data, error } = await supabase
        .from('leads')
        .insert(leadToDbInsert(lead, lead.userId ?? session!.user.id))
        .select('id')
        .single();
      if (error) throw error;
      if (lead.tagIds?.length) {
        await supabase.from('lead_tags').insert(lead.tagIds.map((tagId) => ({ lead_id: data.id, tag_id: tagId })));
      }
      return data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}

export function useBulkCreateLeads() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (leads: Array<Partial<Lead> & { tagIds?: string[] }>) => {
      const rows = leads.map((l) => leadToDbInsert(l, l.userId ?? session!.user.id));
      const { data, error } = await supabase.from('leads').insert(rows).select('id');
      if (error) throw error;
      const tagRows: Array<{ lead_id: string; tag_id: string }> = [];
      data.forEach((row, i) => {
        for (const tagId of leads[i].tagIds ?? []) tagRows.push({ lead_id: row.id, tag_id: tagId });
      });
      if (tagRows.length) await supabase.from('lead_tags').insert(tagRows);
      return data.length;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}

/**
 * Applies `patch` to one lead across every cached leads list/page. Two
 * shapes share the 'leads' key prefix: the full-list array from useLeads()
 * (Kanban/Dashboard/etc.) and the {rows, count} page from useLeadsPage()
 * (the Leads table) — the plain number from useLeadsTotalCount() falls
 * through untouched since patching one lead never changes the account's
 * total lead count. Exported so any mutation that changes a single lead can
 * update the cache in place instead of invalidating (and re-fetching, in
 * 1000-row chunks) the whole account just to reflect one row's change.
 */
function patchLeadInCaches(qc: QueryClient, id: string, patch: (l: Lead) => Lead) {
  qc.setQueriesData({ queryKey: ['leads'] }, (old: unknown) => {
    if (Array.isArray(old)) return old.map((l) => ((l as Lead).id === id ? patch(l as Lead) : l));
    if (old && typeof old === 'object' && Array.isArray((old as LeadsPageResult).rows)) {
      const page = old as LeadsPageResult;
      return { ...page, rows: page.rows.map((l) => (l.id === id ? patch(l) : l)) };
    }
    return old;
  });
}

/**
 * Re-fetches one lead and patches it into every cached leads list/page —
 * for flows where the server may have changed a lead as a side effect (e.g.
 * sending it a first SMS auto-advances stage 'new' to 'contacted', see
 * send-sms) without reporting exactly what changed back to the caller.
 * Costs one single-row request instead of invalidating the entire account's
 * leads list just to catch one lead's possible change.
 */
export async function refetchAndPatchLead(qc: QueryClient, id: string) {
  const { data, error } = await supabase.from('leads').select(LEAD_LIST_SELECT).eq('id', id).single();
  if (error || !data) return;
  const fresh = dbToLead(data);
  patchLeadInCaches(qc, id, () => fresh);
  qc.setQueryData(['lead', id], fresh);
}

export function useUpdateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...lead }: Partial<Lead> & { id: string }) => {
      const { error } = await supabase.from('leads').update(leadToDbUpdate(lead)).eq('id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id, variables) => {
      const { id: _id, ...updates } = variables;
      patchLeadInCaches(qc, id, (l) => ({ ...l, ...updates }));
      qc.invalidateQueries({ queryKey: ['lead', id] });
      qc.invalidateQueries({ queryKey: ['activities', id] });
    },
  });
}

export function useSetLeadTags() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadId, tagIds }: { leadId: string; tagIds: string[] }) => {
      await supabase.from('lead_tags').delete().eq('lead_id', leadId);
      if (tagIds.length) {
        await supabase.from('lead_tags').insert(tagIds.map((tagId) => ({ lead_id: leadId, tag_id: tagId })));
      }
    },
    onSuccess: (_data, vars) => {
      // Already know exactly what changed (vars.tagIds) — patch in place,
      // no need for even the single-row re-fetch refetchAndPatchLead does.
      patchLeadInCaches(qc, vars.leadId, (l) => ({ ...l, tagIds: vars.tagIds }));
      qc.invalidateQueries({ queryKey: ['lead', vars.leadId] });
    },
  });
}

/**
 * PostgREST encodes `.in()` into the URL query string, so a few hundred UUIDs
 * pushes the request URI past the API gateway's length cap and the whole delete
 * fails — at ~37 chars per id, 850 leads is a >30KB URL. 100 per request keeps
 * every URL comfortably small.
 */
const DELETE_CHUNK = 100;

/** Thrown when a chunked delete fails partway, carrying the ids that did land. */
class PartialDeleteError extends Error {
  deletedIds: string[];
  constructor(message: string, deletedIds: string[]) {
    super(message);
    this.name = 'PartialDeleteError';
    this.deletedIds = deletedIds;
  }
}

export function useDeleteLeads() {
  const qc = useQueryClient();

  // Drop the deleted rows straight out of every cached leads list/page. A
  // blanket invalidate would refetch every lead on the account just to learn
  // about the removals. Same two-shape handling as useUpdateLead above; a
  // page's own count shrinks by however many of its rows were removed, and
  // the account-wide total (useLeadsTotalCount) shrinks by the full delete count.
  const dropFromCache = (ids: string[]) => {
    if (!ids.length) return;
    const gone = new Set(ids);
    qc.setQueriesData({ queryKey: ['leads'] }, (old: unknown) => {
      if (Array.isArray(old)) return old.filter((l: Lead) => !gone.has(l.id));
      if (old && typeof old === 'object' && Array.isArray((old as LeadsPageResult).rows)) {
        const page = old as LeadsPageResult;
        const rows = page.rows.filter((l) => !gone.has(l.id));
        return { rows, count: Math.max(0, page.count - (page.rows.length - rows.length)) };
      }
      return old;
    });
    // Not patched optimistically like the lists above: this cache key isn't
    // scoped per-delete-call the way the id-filtered lists are, so a blind
    // decrement here could double-count against another cached account's
    // total (e.g. an admin who's browsed two team members' leads recently).
    // It's a cheap head-only count query, so just invalidate it.
    qc.invalidateQueries({ queryKey: ['leads', 'count'] });
  };

  return useMutation({
    mutationFn: async (ids: string[]) => {
      const deleted: string[] = [];
      for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
        const chunk = ids.slice(i, i + DELETE_CHUNK);
        const { error } = await supabase.from('leads').delete().in('id', chunk);
        // Report what already landed so the UI can reflect reality rather than
        // silently rolling back to a state that is no longer true.
        if (error) throw new PartialDeleteError(error.message, deleted);
        deleted.push(...chunk);
      }
      return deleted;
    },
    onSuccess: (deleted) => {
      dropFromCache(deleted);
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (err) => {
      if (err instanceof PartialDeleteError) dropFromCache(err.deletedIds);
    },
  });
}

export function useUpsertComps() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      leadId,
      comps,
    }: {
      leadId: string;
      comps: Array<{
        kind: 'sold' | 'listing';
        address: string | null;
        price: number | null;
        sale_date: string | null;
        sqft: number | null;
        beds: number | null;
        baths: number | null;
        distance: string | null;
        notes: string | null;
      }>;
    }) => {
      await supabase.from('lead_comps').delete().eq('lead_id', leadId);
      if (comps.length) {
        await supabase.from('lead_comps').insert(comps.map((c) => ({ lead_id: leadId, ...c })));
      }
    },
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: ['lead', vars.leadId] }),
  });
}
