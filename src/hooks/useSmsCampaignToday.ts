import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { localIsoDate } from '@/lib/utils';

/** Whether a bulk SMS campaign has actually gone out today — a plain check
 * against bulk_sms_jobs rather than anything stored, so it can't drift out
 * of sync with what actually happened. */
export function useSmsCampaignRanToday() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['dashboard_sms_campaign_today'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('bulk_sms_jobs')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', `${localIsoDate(new Date())}T00:00:00`);
      if (error) throw error;
      return (count ?? 0) > 0;
    },
    enabled: !!session?.user.id,
  });
}
