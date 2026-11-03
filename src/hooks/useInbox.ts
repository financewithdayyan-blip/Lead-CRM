import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { dbToLead } from '@/lib/mappers';
import type { Lead } from '@/types/domain';

// Just what an Inbox conversation row + its detail pane (SmsThreadTab)
// need — not the full lead record. last_message_at/preview/direction/
// has_unread_sms are trigger-maintained (migration 0190), so this is a
// plain indexed sort, never a live per-lead aggregation.
const INBOX_SELECT =
  'id, first_name, last_name, phone, phone2, email, address, city, state, zip, stage, assigned_sms_number, ai_reply_paused, photo_wait_ai_active, opted_out, lead_tags(tag_id), last_message_at, last_message_preview, last_message_direction, has_unread_sms';

/** Every conversation across the whole team this admin oversees (RLS's own
 *  owner-or-overseer rule on `leads` already scopes this correctly — see
 *  the migration's own note on why this one query can't also add an
 *  explicit user_id filter the way other leads queries do), sorted by
 *  most recent activity. Realtime on `leads` itself rather than the raw
 *  message tables — the trigger-maintained columns are the only thing
 *  that actually needs to move this list, and that also picks up stage/
 *  other lead edits for free. */
// `enabled` defaults true for the Inbox page itself; the Sidebar (which
// calls this everywhere, on every page, just to show the unread badge)
// passes isOverseer explicitly so a caller — who can't open /inbox at all,
// same RLS gate as the per-lead SMS tab — never runs this query or keeps a
// realtime channel open for a page they can't reach.
export function useInboxConversations(enabled = true) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel(`inbox:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => {
        qc.invalidateQueries({ queryKey: ['inbox_conversations'] });
      })
      .subscribe((_status, err) => {
        if (err) console.error('inbox realtime subscribe failed:', err);
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc, enabled]);

  return useQuery({
    queryKey: ['inbox_conversations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select(INBOX_SELECT)
        .not('last_message_at', 'is', null)
        .order('last_message_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []).map(dbToLead) as Lead[];
    },
    enabled,
    staleTime: 15_000,
  });
}

export function useMarkThreadRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (leadId: string) => {
      const { error } = await supabase.from('leads').update({ has_unread_sms: false }).eq('id', leadId).eq('has_unread_sms', true);
      if (error) throw error;
    },
    onMutate: async (leadId) => {
      qc.setQueryData<Lead[]>(['inbox_conversations'], (prev) =>
        prev?.map((l) => (l.id === leadId ? { ...l, hasUnreadSms: false } : l)),
      );
      qc.setQueryData<Lead | undefined>(['lead', leadId], (prev) => (prev ? { ...prev, hasUnreadSms: false } : prev));
    },
  });
}
