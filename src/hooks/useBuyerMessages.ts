import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { SmsNumberKey } from '@/lib/smsNumbers';

export interface BuyerThreadMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  at: string;
}

/** Buyer texts, from the single buyer_messages table (no inbound/activity
 *  split like leads have — buyers don't need the activity-feed concept). */
export function useBuyerThread(buyerId: string | undefined) {
  return useQuery({
    queryKey: ['buyer_thread', buyerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('buyer_messages')
        .select('id, direction, body, created_at')
        .eq('buyer_id', buyerId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []).map(
        (m): BuyerThreadMessage => ({ id: m.id, direction: m.direction as 'inbound' | 'outbound', body: m.body, at: m.created_at }),
      );
    },
    enabled: !!buyerId,
  });
}

/** A manual text to one buyer, via send-buyer-sms — a small, standalone
 *  function that doesn't touch the lead outreach pipeline at all. */
export function useSendBuyerSms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ buyerId, body, fromKey }: { buyerId: string; body: string; fromKey: SmsNumberKey }) => {
      const { data, error } = await supabase.functions.invoke('send-buyer-sms', { body: { buyerId, body, fromKey } });
      if (error) {
        const errBody = await error.context?.json?.().catch(() => null);
        throw new Error(errBody?.error || error.message);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: (_d, { buyerId }) => {
      qc.invalidateQueries({ queryKey: ['buyer_thread', buyerId] });
      qc.invalidateQueries({ queryKey: ['cash_buyers'] });
    },
  });
}
