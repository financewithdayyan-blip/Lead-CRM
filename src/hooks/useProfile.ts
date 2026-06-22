import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export function useUpdateProfile() {
  const { session, refreshProfile } = useAuth();
  return useMutation({
    mutationFn: async (updates: { fullName?: string; dailyGoal?: number; monthlyGoal?: number }) => {
      const payload: Record<string, unknown> = {};
      if (updates.fullName !== undefined) payload.full_name = updates.fullName;
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
      // lead_tags/lead_comps/lead_files/lead_activities cascade-delete with their parent lead.
      await supabase.from('leads').delete().eq('user_id', userId);
      await supabase.from('tags').delete().eq('user_id', userId);
      await supabase.from('tasks').delete().eq('user_id', userId);
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}
