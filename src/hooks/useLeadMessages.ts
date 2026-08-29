import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { SmsNumberKey } from '@/lib/smsNumbers';

export interface ThreadAttachment {
  name: string;
  type: string;
  size: number;
  /** Present once sms-webhook has re-hosted this attachment into the
   * private lead-files bucket — Zoom's own download_url is JWT-signed and
   * expires ~30 minutes after the webhook fires, so it's never usable by
   * the time anyone opens the thread. Attachments received before this
   * re-hosting existed only have the dead Zoom URL and render as a plain
   * label instead of an image. */
  storage_path?: string;
}

export interface ThreadMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  at: string;
  hasAttachments: boolean;
  attachments: ThreadAttachment[];
  isReaction: boolean;
}

/** Inbound texts and outbound sends merged into one chronological thread. */
export function useLeadThread(leadId: string | undefined) {
  const qc = useQueryClient();

  // Live — a reply from the lead, or a text sent from the Zoom app/desktop
  // client directly (sms-webhook now logs those too), shows up the moment
  // it lands instead of waiting on a manual reopen of the tab. Both tables
  // that feed this thread can change independently, so both are watched.
  // Best-effort, same as every other realtime subscription in this codebase
  // (see useTasks) — a failure here must never throw into the profile page.
  useEffect(() => {
    if (!leadId) return;
    let channel: ReturnType<typeof supabase.channel> | undefined;
    try {
      channel = supabase
        .channel(`lead-thread:${leadId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'inbound_messages', filter: `lead_id=eq.${leadId}` },
          () => qc.invalidateQueries({ queryKey: ['lead_thread', leadId] }),
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'lead_activities', filter: `lead_id=eq.${leadId}` },
          () => qc.invalidateQueries({ queryKey: ['lead_thread', leadId] }),
        )
        .subscribe((status, err) => {
          if (err) console.error('lead-thread realtime subscription error', err);
        });
    } catch (e) {
      console.error('lead-thread realtime subscription failed to start', e);
    }
    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [leadId, qc]);

  return useQuery({
    queryKey: ['lead_thread', leadId],
    queryFn: async () => {
      const [inboundRes, activityRes] = await Promise.all([
        supabase
          .from('inbound_messages')
          .select('id, body, received_at, has_attachments, attachments, is_reaction')
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
        attachments: (m.attachments as ThreadAttachment[] | null) ?? [],
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
          attachments: [],
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
 * manual sends in general. isManualReply: true tells send-sms to also pause
 * AI on this lead (photo_wait_ai_active: false silences ai-reply's photo-
 * wait mode specifically) as part of its own parallel write batch — folded
 * in server-side so this doesn't cost a second full round trip after the
 * function has already returned, on top of everything a bulk send already
 * does (Zoom auth, Zoom user lookup, the actual send).
 *
 * The message appears in the thread the instant Send is clicked (onMutate),
 * not after that whole round trip resolves — rolled back on failure,
 * reconciled with the real row (real id, real timestamp) once the network
 * catches up.
 */
export function useSendManualReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadId, body, fromKey }: { leadId: string; body: string; fromKey: SmsNumberKey }) => {
      const { data, error } = await supabase.functions.invoke('send-sms', {
        body: { leadIds: [leadId], templatesByTag: {}, defaultTemplate: body, fromKey, isManualReply: true },
      });
      if (error) {
        const errBody = await error.context?.json?.().catch(() => null);
        throw new Error(errBody?.error || error.message);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onMutate: async ({ leadId, body }) => {
      await qc.cancelQueries({ queryKey: ['lead_thread', leadId] });
      const previous = qc.getQueryData<ThreadMessage[]>(['lead_thread', leadId]);
      const optimistic: ThreadMessage = {
        id: `optimistic:${Date.now()}`,
        direction: 'outbound',
        body,
        at: new Date().toISOString(),
        hasAttachments: false,
        attachments: [],
        isReaction: false,
      };
      qc.setQueryData<ThreadMessage[]>(['lead_thread', leadId], (old) => [...(old ?? []), optimistic]);
      return { previous };
    },
    onError: (_err, { leadId }, context) => {
      if (context?.previous) qc.setQueryData(['lead_thread', leadId], context.previous);
    },
    onSettled: (_d, _e, { leadId }) => {
      qc.invalidateQueries({ queryKey: ['lead_thread', leadId] });
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}
