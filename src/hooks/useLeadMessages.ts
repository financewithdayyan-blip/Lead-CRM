import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { SmsNumberKey } from '@/lib/smsNumbers';

export interface ThreadMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  at: string;
  hasAttachments: boolean;
  isReaction: boolean;
}

/** Inbound texts and outbound sends merged into one chronological thread. */
export function useLeadThread(leadId: string | undefined) {
  return useQuery({
    queryKey: ['lead_thread', leadId],
    queryFn: async () => {
      const [inboundRes, activityRes] = await Promise.all([
        supabase
          .from('inbound_messages')
          .select('id, body, received_at, has_attachments, is_reaction')
          .eq('lead_id', leadId)
          .order('received_at', { ascending: true }),
        supabase
          .from('lead_activities')
          .select('id, body, meta, created_at')
          .eq('lead_id', leadId)
          .eq('type', 'sms')
          .order('created_at', { ascending: true }),
      ]);
      if (inboundRes.error) throw inboundRes.error;
      if (activityRes.error) throw activityRes.error;

      const inbound: ThreadMessage[] = (inboundRes.data ?? []).map((m) => ({
        id: `in:${m.id}`,
        direction: 'inbound',
        body: m.body,
        at: m.received_at,
        hasAttachments: m.has_attachments,
        isReaction: m.is_reaction,
      }));

      // Outbound is read from lead_activities rather than send_log — send_log
      // is the append-only compliance record and deliberately outlives a lead;
      // the activity row is what's meant for on-screen display and disappears
      // with the lead the same as every other activity type does.
      const outbound: ThreadMessage[] = (activityRes.data ?? [])
        .filter((a) => (a.meta as any)?.direction === 'outbound')
        .map((a) => ({
          id: `out:${a.id}`,
          direction: 'outbound',
          body: a.body ?? '',
          at: a.created_at,
          hasAttachments: false,
          isReaction: false,
        }));

      return [...inbound, ...outbound].sort((a, b) => a.at.localeCompare(b.at));
    },
    enabled: !!leadId,
  });
}

/**
 * One message-count map for the whole board, fetched once rather than per
 * card. A per-card query would re-fire on every scroll now that the Kanban
 * columns are virtualized — the same reason receivedShares is fetched once
 * and passed down instead of queried per KanbanCard.
 *
 * Counts both sides of the thread (inbound replies + outbound sends) for
 * every lead regardless of stage — a card with an active outbound-only
 * thread (sent, no reply yet) should still show that a conversation exists,
 * not look identical to a lead that's never been texted at all.
 */
export function useThreadMessageCounts(enabled: boolean) {
  return useQuery({
    queryKey: ['lead_thread_message_counts'],
    queryFn: async () => {
      const [inboundRes, outboundRes] = await Promise.all([
        supabase
          .from('inbound_messages')
          .select('lead_id')
          .eq('is_reaction', false)
          .not('lead_id', 'is', null),
        supabase
          .from('lead_activities')
          .select('lead_id, meta')
          .eq('type', 'sms')
          .not('lead_id', 'is', null),
      ]);
      if (inboundRes.error) throw inboundRes.error;
      if (outboundRes.error) throw outboundRes.error;
      const counts: Record<string, number> = {};
      for (const row of inboundRes.data) {
        if (row.lead_id) counts[row.lead_id] = (counts[row.lead_id] ?? 0) + 1;
      }
      for (const row of outboundRes.data) {
        if (row.lead_id && (row.meta as any)?.direction === 'outbound') {
          counts[row.lead_id] = (counts[row.lead_id] ?? 0) + 1;
        }
      }
      return counts;
    },
    enabled,
  });
}

/**
 * A human sending one message from the thread view. Routed through the same
 * send-sms function as bulk — same sending-window rule, same send_log entry —
 * because the spec draws the exemption only around AI auto-replies, not
 * manual sends in general.
 *
 * Also pauses AI on this lead. Phase 4 doesn't exist yet, but setting the flag
 * now means a thread a human has already touched by hand is correctly marked
 * hands-off the moment auto-reply does exist, with no separate migration.
 */
export function useSendManualReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadId, body, fromKey }: { leadId: string; body: string; fromKey: SmsNumberKey }) => {
      const { data, error } = await supabase.functions.invoke('send-sms', {
        body: { leadIds: [leadId], templatesByTag: {}, defaultTemplate: body, fromKey },
      });
      if (error) {
        const errBody = await error.context?.json?.().catch(() => null);
        throw new Error(errBody?.error || error.message);
      }
      if ((data as any)?.error) throw new Error((data as any).error);

      // photo_wait_ai_active: false is what actually silences ai-reply's
      // photo-wait mode for a Partial Qualified lead — a human just took
      // this conversation over by hand, same as ai_reply_paused means for
      // every other stage.
      await supabase.from('leads').update({ ai_reply_paused: true, photo_wait_ai_active: false }).eq('id', leadId);

      return data;
    },
    onSuccess: (_d, { leadId }) => {
      qc.invalidateQueries({ queryKey: ['lead_thread', leadId] });
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}
