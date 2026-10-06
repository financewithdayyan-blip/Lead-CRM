import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { dbToDailySummary } from '@/lib/mappers';
import { useAuth } from '@/contexts/AuthContext';
import { localIsoDate } from '@/lib/utils';

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

/** Last 7 days of daily summaries across the whole team - used by the Notifications page. */
export function useTeamWeeklySummaries() {
  const { session, profile } = useAuth();
  const ownerId = session?.user.id;
  return useQuery({
    queryKey: ['daily_summaries', 'team_weekly', ownerId],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 7);
      const { data, error } = await supabase
        .from('daily_summaries')
        .select('*, member:profiles!daily_summaries_user_id_fkey(full_name, email)')
        .gte('summary_date', localIsoDate(since))
        .neq('user_id', ownerId)
        .order('summary_date', { ascending: false })
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
