import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useScoreLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (leadId: string) => {
      const { data, error } = await supabase.functions.invoke('score-lead', {
        body: { lead_id: leadId },
      });
      if (error) {
        const body = await error.context?.json?.().catch(() => null);
        throw new Error(body?.error || error.message);
      }
      if (data?.error) throw new Error(data.error);
      return data as { score: number; reasoning: string };
    },
    onSuccess: (_data, leadId) => {
      qc.invalidateQueries({ queryKey: ['lead', leadId] });
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}
