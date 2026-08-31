import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { refetchAndPatchLead } from '@/hooks/useLeads';

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
    // Patch just this lead in place rather than invalidating (and
    // re-fetching, in 1000-row chunks) the whole account's leads list for
    // one lead's new AI score.
    onSuccess: (_data, leadId) => refetchAndPatchLead(qc, leadId),
  });
}
