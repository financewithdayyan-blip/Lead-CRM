import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export interface SmsSendSettings {
  /** Daily cap per sending number, keyed '1'-'4', resetting at midnight
   * Pakistan time (see sends_in_window). Missing or 0 for a key means
   * unlimited for that number. This is what bulk-sms-dispatcher actually
   * enforces — dailyLimitLevels below is just where that number came from. */
  dailyLimits: Record<string, number>;
  /** Each number's currently-active 10DLC level (1-10, see smsDlcLevels.ts),
   * keyed the same as dailyLimits. Missing/0 means that number isn't on the
   * level ladder (no cap). Saving a level also writes its mapped value into
   * dailyLimits so enforcement stays a plain number lookup. */
  dailyLimitLevels: Record<string, number>;
  /** The highest level each number has ever earned — only ever goes up.
   * Dialing a number's active level back down (including to "No cap") never
   * erases this, so earned unlock progress toward the next level survives.
   * See BulkSmsSettingsEditor's 6-of-7-days unlock rule. */
  dailyLimitUnlockedLevels: Record<string, number>;
  perMessageDelayMs: number;
  /** Caps how many leads a single bulk send will ever queue, regardless of
   * how many were selected in the Pipeline — 0 means no cap. Separate from
   * dailyLimits above: that's a per-number daily send cap enforced
   * server-side; this trims the selection itself before a job is even
   * created, so selecting an entire large column doesn't have to also mean
   * remembering to trim it by hand first. */
  dailyTotalLimit: number;
}

/** Matches the table's own column defaults — used before the row has ever
 * loaded, and as the fallback for an admin who's never touched this yet. */
export const DEFAULT_SMS_SEND_SETTINGS: SmsSendSettings = {
  dailyLimits: {},
  dailyLimitLevels: {},
  dailyLimitUnlockedLevels: {},
  perMessageDelayMs: 400,
  dailyTotalLimit: 0,
};

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
        .select('daily_limits, daily_limit_levels, daily_limit_unlocked_levels, per_message_delay_ms, daily_total_limit')
        .eq('user_id', session!.user.id)
        .maybeSingle();
      if (error) throw error;
      return {
        dailyLimits: (data?.daily_limits as Record<string, number>) ?? DEFAULT_SMS_SEND_SETTINGS.dailyLimits,
        dailyLimitLevels: (data?.daily_limit_levels as Record<string, number>) ?? DEFAULT_SMS_SEND_SETTINGS.dailyLimitLevels,
        dailyLimitUnlockedLevels:
          (data?.daily_limit_unlocked_levels as Record<string, number>) ??
          DEFAULT_SMS_SEND_SETTINGS.dailyLimitUnlockedLevels,
        perMessageDelayMs: data?.per_message_delay_ms ?? DEFAULT_SMS_SEND_SETTINGS.perMessageDelayMs,
        dailyTotalLimit: data?.daily_total_limit ?? DEFAULT_SMS_SEND_SETTINGS.dailyTotalLimit,
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
          daily_limit_levels: settings.dailyLimitLevels,
          daily_limit_unlocked_levels: settings.dailyLimitUnlockedLevels,
          per_message_delay_ms: settings.perMessageDelayMs,
          daily_total_limit: settings.dailyTotalLimit,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sms_send_settings'] }),
  });
}
