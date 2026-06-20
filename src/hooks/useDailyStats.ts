import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { dbToDailyStat, dbToSessionLogEntry } from '@/lib/mappers';
import { useAuth } from '@/contexts/AuthContext';

export function useDailyStats(targetUserId?: string) {
  const { session } = useAuth();
  const userId = targetUserId ?? session?.user.id;
  return useQuery({
    queryKey: ['daily_stats', userId],
    queryFn: async () => {
      const { data, error } = await supabase.from('daily_stats').select('*').eq('user_id', userId).order('stat_date');
      if (error) throw error;
      return data.map(dbToDailyStat);
    },
    enabled: !!userId,
  });
}

export function useSessionLog(targetUserId?: string) {
  const { session } = useAuth();
  const userId = targetUserId ?? session?.user.id;
  return useQuery({
    queryKey: ['session_log', userId],
    queryFn: async () => {
      const { data, error } = await supabase.from('session_log').select('*').eq('user_id', userId).order('session_date');
      if (error) throw error;
      return data.map(dbToSessionLogEntry);
    },
    enabled: !!userId,
  });
}

export function useLogSession() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ sessionDate, durationSeconds, callsMade }: { sessionDate: string; durationSeconds: number; callsMade: number }) => {
      const { data: existing } = await supabase
        .from('session_log')
        .select('*')
        .eq('user_id', session!.user.id)
        .eq('session_date', sessionDate)
        .maybeSingle();
      const { error } = await supabase.from('session_log').upsert(
        {
          user_id: session!.user.id,
          session_date: sessionDate,
          duration_seconds: (existing?.duration_seconds ?? 0) + durationSeconds,
          calls_made: (existing?.calls_made ?? 0) + callsMade,
        },
        { onConflict: 'user_id,session_date' },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['session_log'] }),
  });
}
