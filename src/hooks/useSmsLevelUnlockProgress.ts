import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/** Pooled daily send totals for the last 7 complete PKT calendar days
 * (today excluded — it's still in progress), summed across every phone
 * passed in — the account's daily limit is one pooled number across all
 * configured numbers, not per-number, so unlock eligibility checks the
 * whole account's volume against a single day's target. A day with zero
 * sends across every phone simply has no entry, which SmsLevelCard treats
 * the same as "missed" when checking the 6-of-7-days unlock rule — see
 * sms_daily_send_counts. */
export function useSmsLevelUnlockProgress(phones: (string | null | undefined)[]) {
  const validPhones = Array.from(new Set(phones.filter((p): p is string => !!p))).sort();
  return useQuery({
    queryKey: ['sms_daily_send_counts', validPhones],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('sms_daily_send_counts', { p_phones: validPhones, p_days: 7 });
      if (error) throw error;
      const byDay = new Map<string, number>();
      for (const row of data ?? []) {
        byDay.set(row.day, (byDay.get(row.day) ?? 0) + Number(row.sent_count));
      }
      return Array.from(byDay.values());
    },
    enabled: validPhones.length > 0,
  });
}
