import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { localIsoDate } from '@/lib/utils';

export interface FollowupLead {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  stage: string;
  lastActivityAt: string | null;
}

/** Leads worth a nudge today — stalled in a stage where the conversation
 * should still be moving, with no activity at all in the last couple of
 * days. Self-resolving: any new activity on the lead (a reply, a call note,
 * an outbound text) drops it off this list on its own, so nothing has to
 * remember to mark it done. Sorted stalest-first (never-contacted leads
 * first) rather than alphabetically. See get_followup_leads in
 * 0101_task_summary_richer.sql for the exact definition. */
export function useFollowupLeads() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['dashboard_followup_leads'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_followup_leads');
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        firstName: r.first_name,
        lastName: r.last_name,
        phone: r.phone,
        stage: r.stage,
        lastActivityAt: r.last_activity_at,
      })) as FollowupLead[];
    },
    enabled: !!session?.user.id,
  });
}

export interface NoPacketLead {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
}

/** Qualified leads nobody has actually run comps/ARV on yet — no deal
 * packet built at all. See get_no_packet_leads in
 * 0101_task_summary_richer.sql. */
export function useNoPacketLeads() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['dashboard_no_packet_leads'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_no_packet_leads');
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ id: r.id, firstName: r.first_name, lastName: r.last_name, phone: r.phone })) as NoPacketLead[];
    },
    enabled: !!session?.user.id,
  });
}

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
