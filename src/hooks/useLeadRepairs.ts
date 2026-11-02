import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { dbToLeadRepair } from '@/lib/mappers';

export function useLeadRepairs(leadId: string | undefined) {
  return useQuery({
    queryKey: ['lead_repairs', leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lead_repairs')
        .select('*')
        .eq('lead_id', leadId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data.map(dbToLeadRepair);
    },
    enabled: !!leadId,
  });
}

export function useCreateLeadRepair() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadId, item, cost, sortOrder }: { leadId: string; item: string; cost: number; sortOrder: number }) => {
      const { error } = await supabase.from('lead_repairs').insert({ lead_id: leadId, item, cost, sort_order: sortOrder });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: ['lead_repairs', vars.leadId] }),
  });
}

export function useUpdateLeadRepair() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, leadId, cost }: { id: string; leadId: string; cost: number }) => {
      const { error } = await supabase.from('lead_repairs').update({ cost }).eq('id', id);
      if (error) throw error;
      return leadId;
    },
    onSuccess: (leadId) => qc.invalidateQueries({ queryKey: ['lead_repairs', leadId] }),
  });
}

/** Wholesale replace rather than diff — same approach useSavePacket already
 *  takes for packet_repairs. Used by the Rehab Cost Estimator's "Use as Est.
 *  Repairs" button: its own scope (Kitchen/Bathroom/Flooring/HVAC/Plumbing/
 *  Electrical/Foundation/Roof/Paint/Miscellaneous) is the single source of
 *  truth for this lead's itemized repairs, so re-running it should replace
 *  whatever was there before rather than append another copy alongside it. */
export function useReplaceLeadRepairs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadId, items }: { leadId: string; items: Array<{ item: string; cost: number }> }) => {
      const { error: delErr } = await supabase.from('lead_repairs').delete().eq('lead_id', leadId);
      if (delErr) throw delErr;
      if (items.length) {
        const { error } = await supabase
          .from('lead_repairs')
          .insert(items.map((it, i) => ({ lead_id: leadId, item: it.item, cost: it.cost, sort_order: i })));
        if (error) throw error;
      }
      return leadId;
    },
    onSuccess: (leadId) => qc.invalidateQueries({ queryKey: ['lead_repairs', leadId] }),
  });
}

export function useDeleteLeadRepair() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, leadId }: { id: string; leadId: string }) => {
      const { error } = await supabase.from('lead_repairs').delete().eq('id', id);
      if (error) throw error;
      return leadId;
    },
    onSuccess: (leadId) => qc.invalidateQueries({ queryKey: ['lead_repairs', leadId] }),
  });
}
