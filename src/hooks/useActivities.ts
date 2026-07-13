import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { dbToActivity } from '@/lib/mappers';
import { useAuth } from '@/contexts/AuthContext';
import { localIsoDate } from '@/lib/utils';
import type { ActivityType } from '@/types/domain';

export interface AdminNoteNotif {
  id: string;
  leadId: string;
  leadName: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export function useActivities(leadId: string | undefined) {
  return useQuery({
    queryKey: ['activities', leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lead_activities')
        .select('*, author:profiles!user_id(full_name, email, role)')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: true });
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
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['activities', vars.leadId] });
      qc.invalidateQueries({ queryKey: ['today_calls'] });
      qc.invalidateQueries({ queryKey: ['activity_feed'] });
      qc.invalidateQueries({ queryKey: ['admin_notes_on_my_leads'] });
    },
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

export function useUpdateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; leadId: string; body: string }) => {
      const { error } = await supabase.from('lead_activities').update({ body }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['activities', vars.leadId] });
      qc.invalidateQueries({ queryKey: ['activity_feed'] });
      qc.invalidateQueries({ queryKey: ['recent_activities'] });
      qc.invalidateQueries({ queryKey: ['admin_notes_on_my_leads'] });
    },
  });
}

/** Call on hover to warm the cache before navigation. */
export function prefetchActivityFeed(qc: QueryClient, userId: string) {
  const since = `${new Date().getFullYear()}-01-01`;
  return qc.prefetchQuery({
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
    staleTime: 5 * 60_000,
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

/**
 * Set of distinct lead IDs that have a 'call' activity logged today (local date).
 * Query key includes todayIso so the query resets automatically after midnight.
 */
export function useTodayCalledLeadIds(userId: string | undefined) {
  const todayIso = localIsoDate(new Date());
  return useQuery({
    queryKey: ['today_calls', userId, todayIso],
    queryFn: async () => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from('lead_activities')
        .select('lead_id')
        .eq('user_id', userId)
        .eq('type', 'call')
        .gte('created_at', todayStart.toISOString());
      if (error) throw error;
      return new Set(data.map((r: any) => r.lead_id as string));
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

/**
 * Note-type activities on the current caller's leads authored by someone else (admin).
 * Only enabled for non-admin users — admins write notes, callers receive them.
 * Limited to the last 7 days.
 */
export function useAdminNotesOnMyLeads() {
  const { session, profile } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ['admin_notes_on_my_leads', userId],
    queryFn: async () => {
      const since7 = new Date();
      since7.setDate(since7.getDate() - 7);
      const { data, error } = await supabase
        .from('lead_activities')
        .select('*, lead:leads!lead_id(first_name, last_name), author:profiles!user_id(full_name, email)')
        .eq('type', 'note')
        .neq('user_id', userId)
        .gte('created_at', since7.toISOString())
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []).map((row: any): AdminNoteNotif => ({
        id: row.id as string,
        leadId: row.lead_id as string,
        leadName: row.lead
          ? `${row.lead.first_name ?? ''} ${row.lead.last_name ?? ''}`.trim()
          : 'A lead',
        authorName: row.author?.full_name || row.author?.email || 'Admin',
        body: (row.body ?? '') as string,
        createdAt: row.created_at as string,
      }));
    },
    enabled: !!userId && profile?.role !== 'admin',
  });
}
