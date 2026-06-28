import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { dbToDailySummary } from '@/lib/mappers';
import { useAuth } from '@/contexts/AuthContext';
import { localIsoDate } from '@/lib/utils';

export function useMyTodaySummary() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const todayIso = localIsoDate(new Date());
  return useQuery({
    queryKey: ['daily_summaries', 'mine', userId, todayIso],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_summaries')
        .select('*')
        .eq('user_id', userId)
        .eq('summary_date', todayIso)
        .maybeSingle();
      if (error) throw error;
      return data ? dbToDailySummary(data) : null;
    },
    enabled: !!userId,
  });
}

export function useSubmitDailySummary() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (summary: string) => {
      const { error } = await supabase
        .from('daily_summaries')
        .upsert({ user_id: session!.user.id, summary_date: localIsoDate(new Date()), summary }, { onConflict: 'user_id,summary_date' });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['daily_summaries'] }),
  });
}

export function useTeamTodaySummaries() {
  const { session, profile } = useAuth();
  const ownerId = session?.user.id;
  const todayIso = localIsoDate(new Date());
  return useQuery({
    queryKey: ['daily_summaries', 'team', ownerId, todayIso],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_summaries')
        .select('*, member:profiles!daily_summaries_user_id_fkey(full_name, email)')
        .eq('summary_date', todayIso)
        .neq('user_id', ownerId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data.map((row: any) => ({
        ...dbToDailySummary(row),
        memberName: row.member?.full_name || row.member?.email || 'A team member',
      }));
    },
    enabled: !!ownerId && profile?.role === 'admin',
  });
}
