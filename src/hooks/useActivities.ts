import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { dbToActivity } from '@/lib/mappers';
import { useAuth } from '@/contexts/AuthContext';
import type { ActivityType } from '@/types/domain';

export function useActivities(leadId: string | undefined) {
  return useQuery({
    queryKey: ['activities', leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lead_activities')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data.map(dbToActivity);
    },
    enabled: !!leadId,
  });
}

export function useAddActivity() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      leadId,
      type,
      body,
      meta = {},
    }: {
      leadId: string;
      type: ActivityType;
      body: string;
      meta?: Record<string, unknown>;
    }) => {
      const { error } = await supabase
        .from('lead_activities')
        .insert({ lead_id: leadId, user_id: session!.user.id, type, body, meta });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: ['activities', vars.leadId] }),
  });
}

export function useDeleteActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; leadId: string }) => {
      const { error } = await supabase.from('lead_activities').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: ['activities', vars.leadId] }),
  });
}

/** All activity since `sinceIso` (default: start of this year) for dashboard charts. */
export function useActivityFeed(targetUserId?: string, sinceIso?: string) {
  const { session } = useAuth();
  const userId = targetUserId ?? session?.user.id;
  const since = sinceIso ?? `${new Date().getFullYear()}-01-01`;
  return useQuery({
    queryKey: ['activity_feed', userId, since],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lead_activities')
        .select('*')
        .eq('user_id', userId)
        .gte('created_at', since)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data.map(dbToActivity);
    },
    enabled: !!userId,
  });
}

/** Recent activity across every lead the current user owns, for the dashboard feed. */
export function useRecentActivities(targetUserId?: string, limit = 12) {
  const { session } = useAuth();
  const userId = targetUserId ?? session?.user.id;
  return useQuery({
    queryKey: ['recent_activities', userId, limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lead_activities')
        .select('*, leads(first_name, last_name)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data.map((row: any) => ({
        ...dbToActivity(row),
        leadName: row.leads ? `${row.leads.first_name} ${row.leads.last_name}`.trim() : null,
      }));
    },
    enabled: !!userId,
  });
}
