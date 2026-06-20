import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export function useUpdateProfile() {
  const { session, refreshProfile } = useAuth();
  return useMutation({
    mutationFn: async (updates: { callerName?: string; dailyGoal?: number; monthlyGoal?: number }) => {
      const payload: Record<string, unknown> = {};
      if (updates.callerName !== undefined) payload.caller_name = updates.callerName;
      if (updates.dailyGoal !== undefined) payload.daily_goal = updates.dailyGoal;
      if (updates.monthlyGoal !== undefined) payload.monthly_goal = updates.monthlyGoal;
      const { error } = await supabase.from('profiles').update(payload).eq('id', session!.user.id);
      if (error) throw error;
    },
    onSuccess: () => refreshProfile(),
  });
}

export function useEraseAllData() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const userId = session!.user.id;
      await supabase.from('leads').delete().eq('user_id', userId);
      await supabase.from('call_log').delete().eq('user_id', userId);
      await supabase.from('tags').delete().eq('user_id', userId);
      await supabase.from('tasks').delete().eq('user_id', userId);
      await supabase.from('session_log').delete().eq('user_id', userId);
      await supabase.from('daily_stats').delete().eq('user_id', userId);
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}
