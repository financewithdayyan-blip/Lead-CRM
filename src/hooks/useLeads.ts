import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
      const { data, error } = await supabase
        .from('leads')
        .select(LEAD_SELECT)
        .eq('user_id', userId)
        .order('lead_num', { ascending: true });
      if (error) throw error;
      return data.map(dbToLead);
    },
    enabled: !!userId,
  });
}

export function useLead(id: string | undefined) {
  return useQuery({
    queryKey: ['lead', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('leads').select(LEAD_SELECT).eq('id', id).single();
      if (error) throw error;
      return dbToLead(data);
    },
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
        .insert(leadToDbInsert(lead, session!.user.id))
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
      const rows = leads.map((l) => leadToDbInsert(l, session!.user.id));
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
