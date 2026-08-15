import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { SMS_NUMBER_KEYS, type SmsNumberKey } from '@/lib/smsNumbers';

export type SmsNumberLabels = Record<SmsNumberKey, { phoneNumber: string | null; label: string | null }>;

/** Admin-filled-in display labels for the six SMS sending slots — see 0094_sms_number_labels.sql. */
export function useSmsNumberLabels() {
  return useQuery({
    queryKey: ['sms_number_labels'],
    queryFn: async () => {
      const { data, error } = await supabase.from('sms_number_labels').select('slot, phone_number, label');
      if (error) throw error;
      const map = {} as SmsNumberLabels;
      for (const key of SMS_NUMBER_KEYS) map[key] = { phoneNumber: null, label: null };
      for (const row of data) {
        map[row.slot as SmsNumberKey] = { phoneNumber: row.phone_number, label: row.label };
      }
      return map;
    },
  });
}

export function useSaveSmsNumberLabels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rows: { slot: SmsNumberKey; phoneNumber: string; label: string }[]) => {
      const { error } = await supabase.from('sms_number_labels').upsert(
        rows.map((r) => ({
          slot: r.slot,
          phone_number: r.phoneNumber || null,
          label: r.label || null,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'slot' },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sms_number_labels'] }),
  });
}
