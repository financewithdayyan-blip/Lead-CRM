import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface SmsLevelProgress {
  daysElapsed: number;
  /** Of the last 10 days (or since the level started, if shorter), how many
   * had at least one real outbound send — a steady cadence reads better to
   * carriers than sporadic bursts, so this is shown as its own stat rather
   * than folded into the rate numbers. */
  daysActive: number;
  sent: number;
  delivered: number;
  replies: number;
  deliveryRate: number;
  replyRate: number;
}

/** Real deliverability/engagement over the last 10 days (or since the
 * current level started, if that's more recent) — the exact same numbers
 * auto_promote_sms_levels (0154) uses to decide whether to promote, via the
 * shared sms_level_progress RPC, so this can never show something
 * different from what actually gates the next level. */
export function useSmsLevelProgress(since: string | null) {
  return useQuery({
    queryKey: ['sms_level_progress', since],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('sms_level_progress', { p_since: since }).single();
      if (error) throw error;
      const row = data as {
        days_elapsed: number;
        days_active: number;
        sent: number;
        delivered: number;
        replies: number;
        delivery_rate: number;
        reply_rate: number;
      };
      return {
        daysElapsed: row.days_elapsed,
        daysActive: row.days_active,
        sent: row.sent,
        delivered: row.delivered,
        replies: row.replies,
        deliveryRate: row.delivery_rate,
        replyRate: row.reply_rate,
      } as SmsLevelProgress;
    },
    enabled: !!since,
  });
}
