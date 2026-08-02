import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { SmsNumberKey } from '@/lib/smsNumbers';

export interface BulkSmsResult {
  sent: number;
  skipped: { leadId: string; reason: string }[];
  failed: { leadId: string; error: string }[];
  /** How the send split across numbers. More than one lead auto-splits
   * across every configured number; a single lead uses just the one picked. */
  perNumber: { key: string; label: string; sent: number }[];
}

export interface BulkSmsInput {
  leadIds: string[];
  templatesByTag: Record<string, string>;
  defaultTemplate: string;
  /** Only used when leadIds has exactly one entry — a bulk send ignores this
   * and auto-splits across every configured number instead. */
  fromKey: SmsNumberKey;
  perMessageDelayMs?: number;
  dailyLimit?: number;
}

/**
 * Calls the send-sms edge function. The window check, opt-out check and
 * rolling-limit check all happen server-side — this is a thin wrapper, not
 * where any of those rules live.
 */
export function useSendBulkSms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BulkSmsInput) => {
      const { data, error } = await supabase.functions.invoke<BulkSmsResult>('send-sms', { body: input });
      if (error) {
        const body = await error.context?.json?.().catch(() => null);
        throw new Error(body?.error || error.message);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as BulkSmsResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}
