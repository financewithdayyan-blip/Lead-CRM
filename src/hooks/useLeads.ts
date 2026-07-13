import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { dbToLead, leadToDbInsert, leadToDbUpdate } from '@/lib/mappers';
import { useAuth } from '@/contexts/AuthContext';
import type { Lead } from '@/types/domain';

const LEAD_SELECT = '*, lead_tags(tag_id), lead_comps(*), lead_files(*)';

export function useLeads(targetUserId?: string) {
  const { session } = useAuth();
  const userId = targetUserId ?? session?.user.id;
  return useQuery({
    queryKey: ['leads', userId],
    queryFn: async () => {
      const PAGE = 1000;
      const rows: any[] = [];
      let offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from('leads')
          .select(LEAD_SELECT)
          .eq('user_id', userId)
          .order('lead_num', { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        rows.push(...data);
        if (data.length < PAGE) break;
        offset += PAGE;
      }
      return rows.map(dbToLead);
    },
    enabled: !!userId,
  });
}

/** Call on hover to warm the cache before navigation. */
export function prefetchLeads(qc: QueryClient, userId: string) {
  const PAGE = 1000;
  return qc.prefetchQuery({
    queryKey: ['leads', userId],
    queryFn: async () => {
      const rows: any[] = [];
      let offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from('leads')
          .select(LEAD_SELECT)
          .eq('user_id', userId)
          .order('lead_num', { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        rows.push(...data);
        if (data.length < PAGE) break;
        offset += PAGE;
      }
      return rows.map(dbToLead);
    },
    staleTime: 5 * 60_000,
  });
}

export function useLead(id: string | undefined) {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['lead', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('leads').select(LEAD_SELECT).eq('id', id).single();
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
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['leads'] });
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

export function useDeleteLeads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from('leads').delete().in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
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
    mutationFn: async ({ leadId, comps }: { leadId: string; comps: Array<{ address: string | null; price: number | null; sqft: number | null; beds: number | null; baths: number | null; distance: string | null; notes: string | null }> }) => {
      await supabase.from('lead_comps').delete().eq('lead_id', leadId);
      if (comps.length) {
        await supabase.from('lead_comps').insert(comps.map((c) => ({ lead_id: leadId, ...c })));
      }
    },
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: ['lead', vars.leadId] }),
  });
}
