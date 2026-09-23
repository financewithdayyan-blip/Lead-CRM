import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export interface SmsSendSettings {
  /** Total SMS per day across every number combined, resetting at midnight
   * Pakistan time (see sends_in_window). Missing/0 means unlimited. This is
   * what bulk-sms-dispatcher and send-sms actually enforce — dailyLimitLevel
   * below is just where the number came from. */
  dailyLimit: number;
  /** The account's currently-active 10DLC level (1-10, see smsDlcLevels.ts).
   * 0 means not on the level ladder (no cap). Saving a level also writes
   * its mapped value into dailyLimit so enforcement stays a plain number. */
  dailyLimitLevel: number;
  /** The highest level ever earned — only ever goes up. Dialing the active
   * level back down (including to "No cap") never erases this. */
  dailyLimitUnlockedLevel: number;
  /** When the current dailyLimitLevel started — auto-reset by a DB trigger
   * whenever the level actually changes (see 0154). Levels 1-9 auto-promote
   * once 10+ days have passed since this and the account has sustained a
   * 60%+ delivery rate and 15%+ reply rate over that window — see
   * sms_level_progress/auto_promote_sms_levels and useSmsLevelProgress. */
  dailyLimitLevelStartedAt: string | null;
  perMessageDelayMs: number;
}

/** Matches the table's own column defaults — used before the row has ever
 * loaded, and as the fallback for an admin who's never touched this yet. */
export const DEFAULT_SMS_SEND_SETTINGS: SmsSendSettings = {
  dailyLimit: 0,
  dailyLimitLevel: 0,
  dailyLimitUnlockedLevel: 0,
  dailyLimitLevelStartedAt: null,
  perMessageDelayMs: 400,
};

/** The bulk-SMS sending defaults BulkSmsModal pre-fills from, so an admin
 * sets the account's daily limit and the per-message delay once instead of
 * re-entering them on every send. */
export function useSmsSendSettings() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['sms_send_settings', session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sms_send_settings')
        .select('daily_limit, daily_limit_level, daily_limit_unlocked_level, daily_limit_level_started_at, per_message_delay_ms')
        .eq('user_id', session!.user.id)
        .maybeSingle();
      if (error) throw error;
      return {
        dailyLimit: data?.daily_limit ?? DEFAULT_SMS_SEND_SETTINGS.dailyLimit,
        dailyLimitLevel: data?.daily_limit_level ?? DEFAULT_SMS_SEND_SETTINGS.dailyLimitLevel,
        dailyLimitUnlockedLevel: data?.daily_limit_unlocked_level ?? DEFAULT_SMS_SEND_SETTINGS.dailyLimitUnlockedLevel,
        dailyLimitLevelStartedAt: data?.daily_limit_level_started_at ?? DEFAULT_SMS_SEND_SETTINGS.dailyLimitLevelStartedAt,
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
          daily_limit: settings.dailyLimit,
          daily_limit_level: settings.dailyLimitLevel,
          daily_limit_unlocked_level: settings.dailyLimitUnlockedLevel,
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
