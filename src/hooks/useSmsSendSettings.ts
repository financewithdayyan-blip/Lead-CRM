import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export interface SmsSendSettings {
  /** Rolling 24h cap per sending number, keyed '1'-'4'. Missing or 0 for a
   * key means unlimited for that number. */
  dailyLimits: Record<string, number>;
  perMessageDelayMs: number;
}

/** Matches the table's own column defaults — used before the row has ever
 * loaded, and as the fallback for an admin who's never touched this yet. */
export const DEFAULT_SMS_SEND_SETTINGS: SmsSendSettings = { dailyLimits: {}, perMessageDelayMs: 400 };

/** The bulk-SMS sending defaults BulkSmsModal pre-fills from, so an admin
 * sets each number's own rolling daily limit and the per-message delay once
 * instead of re-entering them on every send. */
export function useSmsSendSettings() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['sms_send_settings', session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sms_send_settings')
        .select('daily_limits, per_message_delay_ms')
        .eq('user_id', session!.user.id)
        .maybeSingle();
      if (error) throw error;
      return {
        dailyLimits: (data?.daily_limits as Record<string, number>) ?? DEFAULT_SMS_SEND_SETTINGS.dailyLimits,
        perMessageDelayMs: data?.per_message_delay_ms ?? DEFAULT_SMS_SEND_SETTINGS.perMessageDelayMs,
      } as SmsSendSettings;
    },
    enabled: !!session?.user.id,
  });
}

export function useSaveSmsSendSettings() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (settings: SmsSendSettings) => {
      const { error } = await supabase.from('sms_send_settings').upsert(
        {
          user_id: session!.user.id,
          daily_limits: settings.dailyLimits,
          per_message_delay_ms: settings.perMessageDelayMs,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sms_send_settings'] }),
  });
}
