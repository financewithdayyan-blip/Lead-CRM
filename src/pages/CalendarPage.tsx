import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Clock, MapPin, Plus, Trash2 } from 'lucide-react';
import { addDays, addWeeks, format, isSameDay, startOfWeek } from 'date-fns';
import { useCalendarEvents, useDeleteCalendarEvent } from '@/hooks/useCalendarEvents';
import { AddCalendarEventModal } from '@/components/calendar/AddCalendarEventModal';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { CALENDAR_EVENT_TYPE_CONFIG, type CalendarEvent, type CalendarEventType } from '@/types/domain';

const ALL_TYPES = Object.keys(CALENDAR_EVENT_TYPE_CONFIG) as CalendarEventType[];
// The work day runs evenings into the night (Pakistan time), covering US
// Eastern business hours — 9am Eastern lands around 6:30-7pm Pakistan —
// not a typical 9-to-5. Defaulting to 6pm-6am means the grid opens on the
// hours that are actually in play (through the real bulk-SMS send window)
// instead of a page of empty morning hours to scroll past, or cutting off
// at midnight like it's the end of the day. Hour values past 23 here are
// deliberate — new Date(...).h accepts and normalizes them fine (24 ->
// next day's midnight, 29 -> 5am), which is exactly the "keep counting
// forward past midnight" display this grid wants, not a wraparound bug.
// Still expands earlier on its own (see gridStartHour below) for any real
// event that happens to land before 6pm.
const GRID_START_HOUR_DEFAULT = 18;
const GRID_END_HOUR_DEFAULT = 30;
const HOUR_HEIGHT = 56;

function minutesFromMidnight(iso: string) {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

function fmtTime(iso: string) {
  return format(new Date(iso), 'h:mma').toLowerCase();
}

interface LaidOutEvent {
  event: CalendarEvent;
  startMin: number;
  endMin: number;
  col: number;
  cols: number;
}

/** Lays same-day overlapping events into side-by-side columns instead of
 *  stacking on top of each other — a simple left-to-right greedy packing,
 *  which is plenty for the handful of same-day appointments a single rep's
 *  calendar actually sees. */
function layoutDayEvents(dayEvents: CalendarEvent[]): LaidOutEvent[] {
  const items = dayEvents
    .map((event) => {
      const startMin = minutesFromMidnight(event.startsAt);
      const endMin = event.endsAt ? Math.max(minutesFromMidnight(event.endsAt), startMin + 20) : startMin + 45;
      return { event, startMin, endMin, col: 0, cols: 1 };
    })
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const result: LaidOutEvent[] = [];
  let cluster: LaidOutEvent[] = [];
  let clusterEnd = -Infinity;

  function flush() {
    if (cluster.length === 0) return;
    const maxCols = Math.max(...cluster.map((e) => e.col)) + 1;
    for (const e of cluster) result.push({ ...e, cols: maxCols });
    cluster = [];
  }

  for (const item of items) {
    if (item.startMin >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    const colEnds: number[] = [];
    for (const e of cluster) colEnds[e.col] = Math.max(colEnds[e.col] ?? -Infinity, e.endMin);
    let col = 0;
    while ((colEnds[col] ?? -Infinity) > item.startMin) col++;
    cluster.push({ ...item, col });
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  flush();
  return result;
}

export function CalendarView({ targetUserId, viewOnly = false }: { targetUserId?: string; viewOnly?: boolean }) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { events: rawEvents, isLoading } = useCalendarEvents(targetUserId);
  const deleteEvent = useDeleteCalendarEvent();

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [visibleTypes, setVisibleTypes] = useState<Set<CalendarEventType>>(new Set(ALL_TYPES));
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekEnd = weekDays[6];

  // Bulk SMS is admin-only and account-wide (see App.tsx's "admin only" route
  // comment), so this standing marker only ever shows on the admin's own
  // main calendar — never a rep's, and never a drill-down into one specific
  // rep's calendar (targetUserId/viewOnly), since the send isn't tied to any
  // one person. Synthesized the same way the lead-derived call/follow-up
  // entries are (not stored in calendar_events, not editable) — it's a
  // standing fact about the account, not a schedulable appointment.
  const showBulkSmsReminder = !targetUserId && !viewOnly && profile?.role === 'admin';
  const bulkSmsEvents = useMemo((): CalendarEvent[] => {
    if (!showBulkSmsReminder) return [];
    return weekDays.map((d) => {
      // 6:30pm Pakistan time — when the work day actually starts, not
      // midnight — anchored to the real PKT clock rather than the viewer's
      // own local 6:30pm. PKT is a fixed UTC+5 offset (no DST), so that's
      // always 13:30 UTC on the same calendar day. Rendered back out
      // through each viewer's own local clock same as every other event
      // here: a Pakistan-based viewer sees ~6:30pm, a US Eastern viewer
      // sees ~9:30am (during EDT — Pakistan has no DST but the US does, so
      // this drifts an hour against Eastern clocks specifically when DST
      // flips later in the year; not worth full IANA zone math for a
      // reminder marker).
      const startsAt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 13, 30, 0, 0));
      const iso = startsAt.toISOString();
      return {
        id: `bulk-sms-reminder-${format(d, 'yyyy-MM-dd')}`,
        userId: '',
        leadId: null,
        leadName: null,
        eventType: 'call',
        title: 'Daily Bulk SMS Sending',
        location: null,
        startsAt: iso,
        endsAt: null,
        notes: 'Standing reminder — work day starts 6:30pm Pakistan time (~9:30am US Eastern). Manage from the Bulk SMS page.',
        createdAt: iso,
        editable: false,
      };
    });
  }, [showBulkSmsReminder, weekDays]);
  const events = useMemo(() => [...rawEvents, ...bulkSmsEvents], [rawEvents, bulkSmsEvents]);

  const weekEvents = useMemo(
    () =>
      events.filter((e) => {
        if (!visibleTypes.has(e.eventType)) return false;
        const d = new Date(e.startsAt);
        return d >= weekStart && d < addDays(weekEnd, 1);
      }),
    [events, visibleTypes, weekStart, weekEnd],
  );

  const eventsByDay = useMemo(() => {
    const map = new Map<number, CalendarEvent[]>();
    weekDays.forEach((_, i) => map.set(i, []));
    for (const e of weekEvents) {
      const idx = weekDays.findIndex((d) => isSameDay(d, new Date(e.startsAt)));
      if (idx >= 0) map.get(idx)!.push(e);
    }
    return map;
  }, [weekEvents, weekDays]);

  const { gridStartHour, gridEndHour } = useMemo(() => {
    let min = GRID_START_HOUR_DEFAULT;
    let max = GRID_END_HOUR_DEFAULT;
    for (const e of weekEvents) {
      const sm = minutesFromMidnight(e.startsAt);
      const em = e.endsAt ? minutesFromMidnight(e.endsAt) : sm + 45;
      min = Math.min(min, Math.floor(sm / 60));
      max = Math.max(max, Math.ceil(em / 60));
    }
    return { gridStartHour: min, gridEndHour: max };
  }, [weekEvents]);

  const hours = useMemo(
    () => Array.from({ length: gridEndHour - gridStartHour }, (_, i) => gridStartHour + i),
    [gridStartHour, gridEndHour],
  );
  const gridStartMin = gridStartHour * 60;
  const gridHeight = (gridEndHour - gridStartHour) * HOUR_HEIGHT;

  function toggleType(t: CalendarEventType) {
    setVisibleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  const sidebarEvents = useMemo(() => [...weekEvents].sort((a, b) => a.startsAt.localeCompare(b.startsAt)), [weekEvents]);

  function openLead(leadId: string) {
    navigate(targetUserId ? `/team/${targetUserId}/leads/${leadId}` : `/leads/${leadId}`);
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text">Calendar</h1>
          <p className="text-sm text-text-3">Walkthroughs, calls, signings, and closings{targetUserId ? '' : ' across your pipeline'}</p>
        </div>
        {!viewOnly && (
          <button className="btn btn-primary" onClick={() => setAddOpen(true)}>
            <Plus size={14} /> Add Event
          </button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {ALL_TYPES.map((t) => {
            const cfg = CALENDAR_EVENT_TYPE_CONFIG[t];
            const active = visibleTypes.has(t);
            return (
              <button
                key={t}
                onClick={() => toggleType(t)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors',
                  !active && 'border-border text-text-3 opacity-50 hover:opacity-80',
                )}
                style={active ? { background: `${cfg.color}1a`, borderColor: cfg.color, color: cfg.color } : undefined}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: cfg.color }} />
                {cfg.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1.5">
          <button className="btn !px-2" onClick={() => setWeekStart((d) => addWeeks(d, -1))} title="Previous week">
            <ChevronLeft size={16} />
          </button>
          <button className="btn !px-3 text-[13px]" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>
            Today
          </button>
          <button className="btn !px-2" onClick={() => setWeekStart((d) => addWeeks(d, 1))} title="Next week">
            <ChevronRight size={16} />
          </button>
          <span className="ml-2 text-[13px] font-medium text-text-2">
            {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d, yyyy')}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="card flex-1 overflow-hidden !p-0">
          <div className="grid" style={{ gridTemplateColumns: '56px repeat(7, 1fr)' }}>
            <div className="border-b border-border" />
            {weekDays.map((d) => {
              const today = isSameDay(d, new Date());
              return (
                <div key={d.toISOString()} className={cn('border-b border-l border-border px-2 py-2 text-center', today && 'bg-primary/5')}>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-text-3">{format(d, 'EEE')}</div>
                  <div className={cn('text-[15px] font-semibold', today ? 'text-primary' : 'text-text')}>{format(d, 'd')}</div>
                </div>
              );
            })}
          </div>

          <div className="relative max-h-[600px] overflow-y-auto">
            <div className="grid" style={{ gridTemplateColumns: '56px repeat(7, 1fr)', height: gridHeight }}>
              <div className="relative border-r border-border">
                {hours.map((h) => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 -translate-y-2 px-1.5 text-right text-[11px] text-text-3"
                    style={{ top: (h - gridStartHour) * HOUR_HEIGHT }}
                  >
                    {format(new Date(2000, 0, 1, h), 'h:mma').toLowerCase()}
                  </div>
                ))}
              </div>
              {weekDays.map((d, dayIdx) => {
                const laidOut = layoutDayEvents(eventsByDay.get(dayIdx) ?? []);
                return (
                  <div key={d.toISOString()} className="relative border-l border-border">
                    {hours.map((h) => (
                      <div key={h} className="absolute left-0 right-0 border-t border-border/60" style={{ top: (h - gridStartHour) * HOUR_HEIGHT }} />
                    ))}
                    {laidOut.map((item) => {
                      const cfg = CALENDAR_EVENT_TYPE_CONFIG[item.event.eventType];
                      const top = ((item.startMin - gridStartMin) / 60) * HOUR_HEIGHT;
                      const height = Math.max(((item.endMin - item.startMin) / 60) * HOUR_HEIGHT, 22);
                      const widthPct = 100 / item.cols;
                      return (
                        <button
                          key={item.event.id}
                          onClick={() => setSelected(item.event)}
                          className="absolute overflow-hidden rounded-md border px-1.5 py-1 text-left text-[11px] font-medium leading-tight shadow-sm transition-transform hover:z-10 hover:scale-[1.02]"
                          style={{
                            top,
                            height,
                            left: `${item.col * widthPct}%`,
                            width: `calc(${widthPct}% - 3px)`,
                            background: `${cfg.color}1f`,
                            borderColor: cfg.color,
                            color: cfg.color,
                          }}
                        >
                          <div className="truncate">{item.event.title}</div>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="card w-full shrink-0 !p-0 lg:w-[300px]">
          <div className="border-b border-border px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-text-3">This Week</div>
          <div className="max-h-[656px] divide-y divide-border overflow-y-auto">
            {isLoading && <div className="px-4 py-6 text-center text-[13px] text-text-3">Loading…</div>}
            {!isLoading && sidebarEvents.length === 0 && (
              <div className="px-4 py-6 text-center text-[13px] text-text-3">No events this week.</div>
            )}
            {sidebarEvents.map((e) => {
              const cfg = CALENDAR_EVENT_TYPE_CONFIG[e.eventType];
              return (
                <button key={e.id} onClick={() => setSelected(e)} className="block w-full px-4 py-3 text-left hover:bg-surface-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: cfg.color }}>
                    {cfg.label}
                  </div>
                  <div className="mt-0.5 text-[13px] font-medium text-text">{e.title}</div>
                  <div className="text-[12px] text-text-3">
                    {format(new Date(e.startsAt), 'EEE MMM d')} · {fmtTime(e.startsAt)}
                    {e.endsAt ? `–${fmtTime(e.endsAt)}` : ''}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {addOpen && <AddCalendarEventModal onClose={() => setAddOpen(false)} defaultDate={weekStart} />}

      {selected && (
        <Modal open onClose={() => setSelected(null)} title={CALENDAR_EVENT_TYPE_CONFIG[selected.eventType].label} width="sm">
          <div className="space-y-3">
            <div className="text-[16px] font-semibold text-text">{selected.title}</div>
            <div className="flex items-center gap-1.5 text-[13px] text-text-2">
              <Clock size={14} />
              {format(new Date(selected.startsAt), 'EEEE, MMM d')} · {fmtTime(selected.startsAt)}
              {selected.endsAt ? `–${fmtTime(selected.endsAt)}` : ''}
            </div>
            {selected.location && (
              <div className="flex items-center gap-1.5 text-[13px] text-text-2">
                <MapPin size={14} /> {selected.location}
              </div>
            )}
            {selected.notes && <div className="text-[13px] text-text-2">{selected.notes}</div>}
            <div className="flex items-center justify-between gap-2 pt-2">
              <div className="flex gap-2">
                {selected.leadId && (
                  <button className="btn btn-primary" onClick={() => openLead(selected.leadId!)}>
                    Open lead
                  </button>
                )}
                {selected.id.startsWith('bulk-sms-reminder-') && (
                  <button className="btn btn-primary" onClick={() => navigate('/bulk-sms')}>
                    Go to Bulk SMS
                  </button>
                )}
                <button className="btn" onClick={() => setSelected(null)}>
                  Close
                </button>
              </div>
              {selected.editable && !viewOnly && (
                <button className="btn btn-danger !px-2" title="Delete event" onClick={() => setConfirmDeleteId(selected.id)}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={!!confirmDeleteId}
        title="Delete event?"
        message="This removes the event from the calendar. This can't be undone."
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (confirmDeleteId) deleteEvent.mutate(confirmDeleteId);
          setConfirmDeleteId(null);
          setSelected(null);
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}

export function CalendarPage() {
  return <CalendarView />;
}
