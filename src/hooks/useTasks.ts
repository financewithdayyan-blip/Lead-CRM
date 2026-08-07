import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { dbToTask } from '@/lib/mappers';
import { useAuth } from '@/contexts/AuthContext';

export function useTasks(targetUserId?: string) {
  const { session } = useAuth();
  const userId = targetUserId ?? session?.user.id;
  const qc = useQueryClient();

  // Live — a task the AI creates in the background, or gets checked off from
  // another tab/device, shows up here without waiting on a manual refresh or
  // an unrelated mutation to happen to invalidate this query. This hook is
  // consumed from NotificationsContext, which wraps every authenticated
  // page — a failure here must never throw into that render tree, so it's
  // entirely best-effort: caught, and reported through .subscribe()'s own
  // status callback rather than assumed to succeed.
  useEffect(() => {
    if (!userId) return;
    let channel: ReturnType<typeof supabase.channel> | undefined;
    try {
      channel = supabase
        .channel(`tasks:${userId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${userId}` },
          () => qc.invalidateQueries({ queryKey: ['tasks', userId] }),
        )
        .subscribe((status, err) => {
          if (err) console.error('tasks realtime subscription error', err);
        });
    } catch (e) {
      console.error('tasks realtime subscription failed to start', e);
    }
    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [userId, qc]);

  return useQuery({
    queryKey: ['tasks', userId],
    queryFn: async () => {
      const { data, error } = await supabase.from('tasks').select('*').eq('user_id', userId).order('due_date');
      if (error) throw error;
      return data.map(dbToTask);
    },
    enabled: !!userId,
  });
}

export function useCreateTask() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      leadId,
      title,
      dueDate,
      userId,
    }: {
      leadId: string | null;
      title: string;
      dueDate: string | null;
      userId?: string;
    }) => {
      const { error } = await supabase
        .from('tasks')
        .insert({ user_id: userId ?? session!.user.id, lead_id: leadId, title, due_date: dueDate });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useToggleTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: boolean }) => {
      const { error } = await supabase.from('tasks').update({ completed }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('tasks').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}
