import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/** Per-phone daily send counts for the last 7 complete PKT calendar days
 * (today excluded — it's still in progress). A day with zero sends simply
 * has no entry, which SmsNumberLevelsCard treats the same as "missed" when
 * checking a level's 6-of-7-days unlock rule — see sms_daily_send_counts. */
export function useSmsLevelUnlockProgress(phones: (string | null | undefined)[]) {
  const validPhones = Array.from(new Set(phones.filter((p): p is string => !!p))).sort();
  return useQuery({
    queryKey: ['sms_daily_send_counts', validPhones],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('sms_daily_send_counts', { p_phones: validPhones, p_days: 7 });
      if (error) throw error;
      const byPhone = new Map<string, number[]>();
      for (const row of data ?? []) {
        const arr = byPhone.get(row.phone) ?? [];
        arr.push(row.sent_count);
        byPhone.set(row.phone, arr);
      }
      return byPhone;
    },
    enabled: validPhones.length > 0,
  });
}
