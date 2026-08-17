import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { dbToMarketingSpend } from '@/lib/mappers';
import { useAuth } from '@/contexts/AuthContext';

export function useMarketingSpend() {
  return useQuery({
    queryKey: ['marketing_spend'],
    queryFn: async () => {
      const { data, error } = await supabase.from('marketing_spend').select('*').order('period_start', { ascending: false });
      if (error) throw error;
      return data.map(dbToMarketingSpend);
    },
  });
}

export function useCreateMarketingSpend() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { source: string; amount: number; periodStart: string; periodEnd: string; notes?: string }) => {
      const { data, error } = await supabase
        .from('marketing_spend')
        .insert({
          user_id: session!.user.id,
          source: input.source,
          amount: input.amount,
          period_start: input.periodStart,
          period_end: input.periodEnd,
          notes: input.notes || null,
        })
        .select('*')
        .single();
      if (error) throw error;
      return dbToMarketingSpend(data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['marketing_spend'] }),
  });
}

export function useDeleteMarketingSpend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('marketing_spend').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['marketing_spend'] }),
  });
}
