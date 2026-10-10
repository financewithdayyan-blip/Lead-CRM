import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { dbToCalendarEvent } from '@/lib/mappers';
import { useAuth } from '@/contexts/AuthContext';
import { leadDisplayName } from '@/lib/utils';
import type { CalendarEvent, CalendarEventType } from '@/types/domain';

async function fetchManualEvents(targetUserId?: string): Promise<CalendarEvent[]> {
  let query = supabase
    .from('calendar_events')
    .select('*, lead:leads(first_name, last_name)')
    .order('starts_at', { ascending: true });
  if (targetUserId) query = query.eq('user_id', targetUserId);
  const { data, error } = await query;
  if (error) throw error;
  return data.map(dbToCalendarEvent);
}

// Calls/follow-ups aren't duplicated into calendar_events — they're read
// straight off each lead's existing scheduled-callback/next-follow-up
// fields (the same source CalendarStrip's Dashboard widget already uses),
// so nothing on the calendar ever goes stale relative to the lead itself.
// Synthesized, not editable here: editing happens on the lead profile.
async function fetchLeadDerivedEvents(targetUserId?: string): Promise<CalendarEvent[]> {
  let query = supabase
    .from('leads')
    .select('id, first_name, last_name, stage, next_follow_up, next_follow_up_time, scheduled_callback_at, scheduled_callback_note, user_id')
    .neq('stage', 'dead_declined')
    .or('next_follow_up.not.is.null,scheduled_callback_at.not.is.null');
  if (targetUserId) query = query.eq('user_id', targetUserId);
  const { data, error } = await query;
  if (error) throw error;

  const events: CalendarEvent[] = [];
  for (const row of data as any[]) {
    const name = leadDisplayName(row.first_name, row.last_name) || 'Lead';
    if (row.scheduled_callback_at) {
      events.push({
        id: `lead-callback-${row.id}`,
        userId: row.user_id,
        leadId: row.id,
        leadName: name,
        eventType: 'call',
        title: row.scheduled_callback_note || `Call ${name}`,
        location: null,
        startsAt: row.scheduled_callback_at,
        endsAt: null,
        notes: row.scheduled_callback_note,
        createdAt: row.scheduled_callback_at,
        editable: false,
      });
    }
    if (row.next_follow_up) {
      const time = row.next_follow_up_time ? row.next_follow_up_time.slice(0, 5) : '09:00';
      events.push({
        id: `lead-followup-${row.id}`,
        userId: row.user_id,
        leadId: row.id,
        leadName: name,
        eventType: 'call',
        title: `Follow up ${name}`,
        location: null,
        startsAt: `${row.next_follow_up}T${time}:00`,
        endsAt: null,
        notes: null,
        createdAt: row.next_follow_up,
        editable: false,
      });
    }
  }
  return events;
}

/** Admin's own call (no targetUserId) relies on RLS alone — the same
 *  "user_id = auth.uid() or is_team_overseer(user_id)" shape used
 *  everywhere else — to merge their whole team's events in; a rep calling
 *  it the same way only ever gets their own rows back. Passing
 *  targetUserId narrows to one specific member (the /team/:id drill-down). */
export function useCalendarEvents(targetUserId?: string) {
  const { session } = useAuth();
  const ownerKey = targetUserId ?? session?.user.id;
  const manual = useQuery({
    queryKey: ['calendar_events', ownerKey],
    queryFn: () => fetchManualEvents(targetUserId),
    enabled: !!session,
  });
  const leadDerived = useQuery({
    queryKey: ['calendar_lead_events', ownerKey],
    queryFn: () => fetchLeadDerivedEvents(targetUserId),
    enabled: !!session,
  });
  const events = useMemo(
    () => [...(manual.data ?? []), ...(leadDerived.data ?? [])].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [manual.data, leadDerived.data],
  );
  return { events, isLoading: manual.isLoading || leadDerived.isLoading };
}

/** Manual calendar_events rows tied to one specific lead — used by the Lead
 *  Profile's own "Events" sidebar card. Deliberately doesn't also merge in
 *  fetchLeadDerivedEvents' synthetic call/follow-up entries for this lead —
 *  those are already shown via the Contact sidebar card's own "Next
 *  follow-up" row, so repeating them here would just be the same fact
 *  twice. */
export function useCalendarEventsForLead(leadId: string | undefined) {
  return useQuery({
    queryKey: ['calendar_events', 'lead', leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('calendar_events')
        .select('*, lead:leads(first_name, last_name)')
        .eq('lead_id', leadId)
        .order('starts_at', { ascending: true });
      if (error) throw error;
      return data.map(dbToCalendarEvent);
    },
    enabled: !!leadId,
  });
}

export function useCreateCalendarEvent() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      eventType: CalendarEventType;
      title: string;
      leadId: string | null;
      location: string | null;
      startsAt: string;
      endsAt: string | null;
      notes: string | null;
    }) => {
      const { error } = await supabase.from('calendar_events').insert({
        user_id: session!.user.id,
        lead_id: input.leadId,
        event_type: input.eventType,
        title: input.title,
        location: input.location,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        notes: input.notes,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calendar_events'] }),
  });
}

export function useDeleteCalendarEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('calendar_events').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calendar_events'] }),
  });
}
