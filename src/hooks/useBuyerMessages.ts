import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { SmsNumberKey } from '@/lib/smsNumbers';

export interface BuyerThreadMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  channel: 'sms' | 'email';
  body: string;
  at: string;
}

export interface LatestBuyerMessage {
  buyerId: string;
  direction: 'inbound' | 'outbound';
  channel: 'sms' | 'email';
  body: string;
  at: string;
}

/** One row per buyer — whichever of their messages (SMS or email, either
 *  direction) is most recent. Backs the Disposition "Messages" tab's
 *  conversation list. cash_buyers is a small table (tens to low hundreds of
 *  rows, not leads' tens of thousands), so a plain ordered scan reduced
 *  client-side to "first row seen per buyer_id" is simple and fast enough —
 *  no denormalized last-message column needed like the lead Inbox has. */
export function useLatestBuyerMessages() {
  return useQuery({
    queryKey: ['buyer_messages_latest'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('buyer_messages')
        .select('buyer_id, direction, channel, body, created_at')
        .order('created_at', { ascending: false })
        .limit(2000);
      if (error) throw error;
      const latest = new Map<string, LatestBuyerMessage>();
      for (const m of data ?? []) {
        if (latest.has(m.buyer_id)) continue;
        latest.set(m.buyer_id, {
          buyerId: m.buyer_id,
          direction: m.direction as 'inbound' | 'outbound',
          channel: (m.channel ?? 'sms') as 'sms' | 'email',
          body: m.body,
          at: m.created_at,
        });
      }
      return latest;
    },
  });
}

/** Buyer texts, from the single buyer_messages table (no inbound/activity
 *  split like leads have — buyers don't need the activity-feed concept). */
export function useBuyerThread(buyerId: string | undefined) {
  return useQuery({
    queryKey: ['buyer_thread', buyerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('buyer_messages')
        .select('id, direction, channel, body, created_at')
        .eq('buyer_id', buyerId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []).map(
        (m): BuyerThreadMessage => ({
          id: m.id,
          direction: m.direction as 'inbound' | 'outbound',
          channel: (m.channel ?? 'sms') as 'sms' | 'email',
          body: m.body,
          at: m.created_at,
        }),
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
      qc.invalidateQueries({ queryKey: ['buyer_messages_latest'] });
    },
  });
}
