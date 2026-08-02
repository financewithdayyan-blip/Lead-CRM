import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface BulkSmsResult {
  sent: number;
  skipped: { leadId: string; reason: string }[];
  failed: { leadId: string; error: string }[];
  from: string;
}

export interface BulkSmsInput {
  leadIds: string[];
  templatesByTag: Record<string, string>;
  defaultTemplate: string;
  fromKey: '1' | '2';
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
