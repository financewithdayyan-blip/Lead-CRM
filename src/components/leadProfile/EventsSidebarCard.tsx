import { useState } from 'react';
import { CalendarDays, Plus, Trash2 } from 'lucide-react';
import { CardHeader } from '@/components/ui/CardHeader';
import { AddCalendarEventModal } from '@/components/calendar/AddCalendarEventModal';
import { useCalendarEventsForLead, useDeleteCalendarEvent } from '@/hooks/useCalendarEvents';
import { formatDateTime, leadDisplayName } from '@/lib/utils';
import { CALENDAR_EVENT_TYPE_CONFIG } from '@/types/domain';
import type { Lead } from '@/types/domain';

export function EventsSidebarCard({ lead }: { lead: Lead }) {
  const { data: events = [] } = useCalendarEventsForLead(lead.id);
  const deleteEvent = useDeleteCalendarEvent();
  const [adding, setAdding] = useState(false);

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2">
        <CardHeader icon={CalendarDays} title="Events" />
        <button className="text-text-3 hover:text-primary" onClick={() => setAdding(true)} title="Add event">
          <Plus size={15} />
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {events.length === 0 && <div className="text-[13px] text-text-3">No events scheduled for this lead.</div>}
        {events.map((e) => {
          const cfg = CALENDAR_EVENT_TYPE_CONFIG[e.eventType];
          return (
            <div key={e.id} className="group flex items-start gap-2">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: cfg.color }} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-text">{e.title}</div>
                <div className="text-[11px] text-text-3">
                  {cfg.label} · {formatDateTime(e.startsAt)}
                </div>
              </div>
              <button
                className="shrink-0 text-text-3 opacity-0 hover:text-danger group-hover:opacity-100"
                onClick={() => deleteEvent.mutate(e.id)}
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>

      {adding && (
        <AddCalendarEventModal
          onClose={() => setAdding(false)}
          initialLead={{ id: lead.id, name: leadDisplayName(lead.firstName, lead.lastName) || 'Lead', address: lead.address }}
        />
      )}
    </div>
  );
}
