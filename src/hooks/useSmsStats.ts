import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fetchAllPages } from '@/lib/paginate';

export interface SendLogRow {
  id: string;
  sentFrom: string;
  createdAt: string;
}

/**
 * The append-only outreach log — deliberately outlives the lead it refers
 * to, so this is the only correct source for "how many have we ever sent",
 * unlike lead_activities which disappears with the lead. Account-wide, same
 * as inbound_messages below: send_log.user_id records who/what triggered
 * each send (the admin for a manual/bulk send, but the lead's own owner for
 * an AI auto-reply or a backfilled historical message), not "which admin is
 * viewing the dashboard" — filtering on the viewing admin's own id here
 * silently dropped every AI/backfilled send from the SMS Sent trend while
 * Replies stayed unscoped, making replies outnumber sends on the chart.
 * Admin-only RLS means a caller's query here just comes back empty;
 * `enabled` additionally skips firing it at all for a caller session.
 */
export function useSendLog(enabled: boolean) {
  return useQuery({
    queryKey: ['send_log_all'],
    queryFn: async () => {
      const rows = await fetchAllPages<{ id: string; sent_from: string; sent_at: string }>((from, to) =>
        supabase.from('send_log').select('id, sent_from, sent_at').order('sent_at', { ascending: true }).range(from, to),
      );
      return rows.map((r): SendLogRow => ({ id: r.id, sentFrom: r.sent_from, createdAt: r.sent_at }));
    },
    enabled,
  });
}

export interface InboundRow {
  id: string;
  isReaction: boolean;
  hasAttachments: boolean;
  receivedAt: string;
  leadId: string | null;
}

/**
 * inbound_messages has no user_id column — Zoom delivers to the shared
 * business number, not a specific CRM user — so this is account-wide by
 * design, same as the webhook itself. Admin-only RLS, same as send_log.
 */
export function useInboundMessages(enabled: boolean) {
  return useQuery({
    queryKey: ['inbound_messages_all'],
    queryFn: async () => {
      const rows = await fetchAllPages<{
        id: string;
        is_reaction: boolean;
        has_attachments: boolean;
        received_at: string;
        lead_id: string | null;
      }>((from, to) =>
        supabase
          .from('inbound_messages')
          .select('id, is_reaction, has_attachments, received_at, lead_id')
          .order('received_at', { ascending: true })
          .range(from, to),
      );
      return rows.map(
        (r): InboundRow => ({
          id: r.id,
          isReaction: r.is_reaction,
          hasAttachments: r.has_attachments,
          receivedAt: r.received_at,
          leadId: r.lead_id,
        }),
      );
    },
    enabled,
  });
}
