import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { dbToLead, leadToDbInsert, leadToDbUpdate } from '@/lib/mappers';
import { useAuth } from '@/contexts/AuthContext';
import type { Lead } from '@/types/domain';

// List views (Kanban, leads table, dashboard) don't render comps or files —
// omitting them cuts payload by ~70% for large accounts.
const LEAD_LIST_SELECT = '*, lead_tags(tag_id)';
// Detail view (lead profile) needs comps and files.
const LEAD_DETAIL_SELECT = '*, lead_tags(tag_id), lead_comps(*), lead_files(*)';

const PAGE = 1000;

/**
 * Fetches every lead for a user. A `head: true` count gives us the page count up
 * front so all pages fire in parallel — the previous serial loop paid one full
 * round-trip per 1000 leads before the next could even start.
 *
 * A lead inserted between the count and the page reads can be missed until the
 * next refetch; the serial version had the same race and it self-corrects on
 * the next invalidate.
 */
async function fetchLeadsPaged(userId: string): Promise<Lead[]> {
  const { count, error: countError } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (countError) throw countError;
  if (!count) return [];

  const pages = await Promise.all(
    Array.from({ length: Math.ceil(count / PAGE) }, async (_, i) => {
      const { data, error } = await supabase
        .from('leads')
        .select(LEAD_LIST_SELECT)
        .eq('user_id', userId)
        .order('lead_num', { ascending: true })
        .range(i * PAGE, i * PAGE + PAGE - 1);
      if (error) throw error;
      return data;
    }),
  );

  return pages.flat().map(dbToLead);
}

export function useLeads(targetUserId?: string) {
  const { session } = useAuth();
  const userId = targetUserId ?? session?.user.id;
  return useQuery({
    queryKey: ['leads', userId],
    queryFn: () => fetchLeadsPaged(userId!),
    enabled: !!userId,
  });
}

/** Call on hover to warm the cache before navigation. */
export function prefetchLeads(qc: QueryClient, userId: string) {
  return qc.prefetchQuery({
    queryKey: ['leads', userId],
    queryFn: () => fetchLeadsPaged(userId),
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
      // Patch the list cache in place — no full refetch of 4000 leads.
      qc.setQueriesData<Lead[]>({ queryKey: ['leads'] }, (old) =>
        old?.map((l) => (l.id === id ? { ...l, ...updates } : l)),
      );
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
      qc.invalidateQueries({ queryKey: ['leads'] });
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

  // Drop the deleted rows straight out of the list cache. A blanket invalidate
  // would refetch every lead on the account just to learn about the removals.
  const dropFromCache = (ids: string[]) => {
    if (!ids.length) return;
    const gone = new Set(ids);
    qc.setQueriesData<Lead[]>({ queryKey: ['leads'] }, (old) => old?.filter((l) => !gone.has(l.id)));
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

export function useOverrideFollowupEarlyExit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (leadId: string) => {
      const { error } = await supabase.rpc('override_followup_early_exit', { p_lead_id: leadId });
      if (error) throw error;
    },
    onSuccess: (_data, leadId) => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['lead', leadId] });
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
