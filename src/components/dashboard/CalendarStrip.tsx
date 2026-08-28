import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, CheckSquare, ChevronLeft, ChevronRight, Circle, Loader2, PhoneCall, Square } from 'lucide-react';
import { useTasks, useToggleTask } from '@/hooks/useTasks';
import { useAddActivity } from '@/hooks/useActivities';
import { useUpdateLead } from '@/hooks/useLeads';
import { Modal } from '@/components/ui/Modal';
import { formatPhone, formatClockTime, leadDisplayName, localIsoDate } from '@/lib/utils';
import type { Lead } from '@/types/domain';

const DAYS_VISIBLE_STEP = 3; // how many day-columns the arrows scroll by
const DAY_COLUMN_WIDTH = 148; // px, keep in sync with the w-[Npx] class below
const DAYS_TOTAL = 14;

/** Same flow as the old ScheduledCallsCard — logs what happened on the call
 * as a real activity (twice, so it shows in both Call History and Notes),
 * then clears the callback so it drops off the calendar. */
function MarkCallCompleteModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const [notes, setNotes] = useState('');
  const addActivity = useAddActivity();
  const updateLead = useUpdateLead();
  const saving = addActivity.isPending || updateLead.isPending;

  async function handleSubmit() {
    if (!notes.trim()) return;
    const body = notes.trim();
    await addActivity.mutateAsync({ leadId: lead.id, type: 'call', body, meta: { scheduledCallCompleted: true } });
    await addActivity.mutateAsync({ leadId: lead.id, type: 'note', body: `Scheduled call: ${body}` });
    await updateLead.mutateAsync({ id: lead.id, scheduledCallbackAt: null, scheduledCallbackNote: null });
    onClose();
  }

  const displayName = leadDisplayName(lead.firstName, lead.lastName) ?? 'this lead';

  return (
    <Modal open onClose={onClose} title={`Mark call with ${displayName} complete`} width="sm">
      <div className="space-y-3">
        {lead.scheduledCallbackNote && (
          <p className="text-[12px] text-text-3">They asked for a call: "{lead.scheduledCallbackNote}"</p>
        )}
        <div>
          <label className="label">What's the update on this lead?</label>
          <textarea
            className="input min-h-[90px] resize-none"
            placeholder="What happened on the call — any new info, next step, etc."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving || !notes.trim()}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Mark completed
          </button>
        </div>
      </div>
    </Modal>
  );
}

interface CalendarItem {
  id: string;
  kind: 'call' | 'followup' | 'task';
  time: string | null; // "HH:MM" 24h, for sorting + display — null = all-day
  title: string;
  sub?: string;
  href?: string;
  overdue: boolean;
  // kind-specific payload for the row's own action
  lead?: Lead;
  taskId?: string;
  completed?: boolean;
}

const KIND_STYLE: Record<CalendarItem['kind'], { dot: string; label: string }> = {
  call: { dot: 'bg-primary', label: 'Call' },
  followup: { dot: 'bg-accent', label: 'Follow-up' },
  task: { dot: 'bg-info', label: 'Task' },
};

function CalendarItemRow({
  item,
  onToggleTask,
  onCompleteCall,
}: {
  item: CalendarItem;
  onToggleTask: (id: string, completed: boolean) => void;
  onCompleteCall: (lead: Lead) => void;
}) {
  const style = KIND_STYLE[item.kind];
  const body = (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} title={style.label} />
        <span className={`truncate text-[11.5px] font-medium ${item.completed ? 'text-text-3 line-through' : 'text-text'}`}>
          {item.title}
        </span>
      </div>
      <div className={`ml-2.5 truncate text-[10px] ${item.overdue ? 'text-danger' : 'text-text-3'}`}>
        {item.time ? formatClockTime(item.time) : 'All day'}
        {item.overdue ? ' · Overdue' : ''}
      </div>
    </div>
  );

  return (
    <div className="flex items-center gap-1 rounded-md border border-border-2 bg-surface px-1.5 py-1" title={item.sub}>
      {item.kind === 'task' && item.taskId && (
        <button
          onClick={() => onToggleTask(item.taskId!, !item.completed)}
          className="shrink-0 text-text-3 hover:text-success"
          title={item.completed ? 'Mark incomplete' : 'Mark complete'}
        >
          {item.completed ? <CheckSquare size={13} /> : <Square size={13} />}
        </button>
      )}
      {item.kind === 'call' && item.lead && (
        <button
          onClick={() => onCompleteCall(item.lead!)}
          className="shrink-0 text-text-3 hover:text-success"
          title="Mark this call completed"
        >
          <Circle size={13} />
        </button>
      )}
      {item.href ? (
        <Link to={item.href} className="min-w-0 flex-1">
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}

/** Replaces the old side-by-side Scheduled Calls + Tasks cards with one
 * Google-Calendar-style horizontal strip — 14 days, each showing whatever's
 * actually due that day: a real callback time (from the AI's own
 * qualification step), a lead's Next Follow-Up, or a manually created task.
 * Anything overdue (before today) collapses onto today's column rather than
 * disappearing off the front of the window, so nothing quietly falls through.
 */
export function CalendarStrip({ userId, leads }: { userId: string; leads: Lead[] }) {
  const { data: tasks = [] } = useTasks(userId);
  const toggleTask = useToggleTask();
  const [completingCall, setCompletingCall] = useState<Lead | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const todayIso = localIsoDate(new Date());

  const days = useMemo(() => {
    const base = new Date();
    return Array.from({ length: DAYS_TOTAL }, (_, i) => {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
      return {
        iso: localIsoDate(d),
        weekday: d.toLocaleDateString([], { weekday: 'short' }),
        month: d.toLocaleDateString([], { month: 'short' }),
        dayNum: d.getDate(),
        isToday: i === 0,
      };
    });
  }, []);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const d of days) map.set(d.iso, []);
    // Anything scheduled before today collapses onto today rather than
    // vanishing off the front of a forward-only window — an overdue
    // callback/follow-up/task is still the most urgent thing to see, today.
    const bucket = (iso: string) => (iso < todayIso ? todayIso : iso);

    for (const lead of leads) {
      if (!lead.scheduledCallbackAt) continue;
      const callDate = new Date(lead.scheduledCallbackAt);
      const iso = localIsoDate(callDate);
      const bucketIso = bucket(iso);
      if (!map.has(bucketIso)) continue;
      const hhmm = `${String(callDate.getHours()).padStart(2, '0')}:${String(callDate.getMinutes()).padStart(2, '0')}`;
      map.get(bucketIso)!.push({
        id: `call-${lead.id}`,
        kind: 'call',
        time: hhmm,
        title: leadDisplayName(lead.firstName, lead.lastName) ?? formatPhone(lead.phone),
        sub: lead.scheduledCallbackNote ?? undefined,
        href: `/leads/${lead.id}`,
        overdue: iso < todayIso,
        lead,
      });
    }

    for (const lead of leads) {
      if (!lead.nextFollowUp || lead.stage === 'dead_declined') continue;
      const bucketIso = bucket(lead.nextFollowUp);
      if (!map.has(bucketIso)) continue;
      map.get(bucketIso)!.push({
        id: `followup-${lead.id}`,
        kind: 'followup',
        time: lead.nextFollowUpTime,
        title: leadDisplayName(lead.firstName, lead.lastName) ?? formatPhone(lead.phone),
        href: `/leads/${lead.id}`,
        overdue: lead.nextFollowUp < todayIso,
      });
    }

    for (const t of tasks) {
      if (t.completed || !t.dueDate) continue;
      const bucketIso = bucket(t.dueDate);
      if (!map.has(bucketIso)) continue;
      map.get(bucketIso)!.push({
        id: `task-${t.id}`,
        kind: 'task',
        time: t.dueTime,
        title: t.title,
        href: t.leadId ? `/leads/${t.leadId}` : undefined,
        overdue: t.dueDate < todayIso,
        taskId: t.id,
        completed: t.completed,
      });
    }

    for (const list of map.values()) {
      list.sort((a, b) => {
        if (!a.time && !b.time) return 0;
        if (!a.time) return -1;
        if (!b.time) return 1;
        return a.time.localeCompare(b.time);
      });
    }
    return map;
  }, [days, leads, tasks, todayIso]);

  function scroll(dir: 1 | -1) {
    scrollRef.current?.scrollBy({ left: dir * DAYS_VISIBLE_STEP * (DAY_COLUMN_WIDTH + 8), behavior: 'smooth' });
  }

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text">
          <PhoneCall size={14} /> Calendar
        </h3>
        <div className="flex gap-1">
          <button onClick={() => scroll(-1)} className="rounded-md border border-border-2 p-1 text-text-3 hover:border-border hover:text-text" title="Earlier days">
            <ChevronLeft size={14} />
          </button>
          <button onClick={() => scroll(1)} className="rounded-md border border-border-2 p-1 text-text-3 hover:border-border hover:text-text" title="Later days">
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="no-scrollbar flex gap-2 overflow-x-auto scroll-smooth pb-1"
        style={{ scrollSnapType: 'x mandatory' }}
      >
        {days.map((d) => {
          const items = itemsByDay.get(d.iso) ?? [];
          return (
            <div
              key={d.iso}
              className={`shrink-0 rounded-lg border ${d.isToday ? 'border-primary/50 bg-primary/5' : 'border-border-2 bg-surface-3'}`}
              style={{ width: DAY_COLUMN_WIDTH, scrollSnapAlign: 'start' }}
            >
              <div className={`flex items-center justify-between border-b px-2.5 py-1.5 ${d.isToday ? 'border-primary/30' : 'border-border-2'}`}>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-text-3">{d.isToday ? 'Today' : d.weekday}</div>
                  <div className={`text-[14px] font-bold ${d.isToday ? 'text-primary' : 'text-text'}`}>
                    {d.month} {d.dayNum}
                  </div>
                </div>
                {items.length > 0 && (
                  <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-text-3">{items.length}</span>
                )}
              </div>
              <div className="max-h-[280px] min-h-[60px] space-y-1 overflow-y-auto p-1.5">
                {items.length === 0 && <div className="px-1 py-3 text-center text-[11px] text-text-3">—</div>}
                {items.map((item) => (
                  <CalendarItemRow
                    key={item.id}
                    item={item}
                    onToggleTask={(id, completed) => toggleTask.mutate({ id, completed })}
                    onCompleteCall={setCompletingCall}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {completingCall && <MarkCallCompleteModal lead={completingCall} onClose={() => setCompletingCall(null)} />}
    </div>
  );
}
