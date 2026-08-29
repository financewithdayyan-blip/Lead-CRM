import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, CheckSquare, ChevronLeft, ChevronRight, Circle, ListChecks, Loader2, MessageSquare, PhoneCall, Square } from 'lucide-react';
import { useTasks, useToggleTask } from '@/hooks/useTasks';
import { useAddActivity } from '@/hooks/useActivities';
import { useUpdateLead } from '@/hooks/useLeads';
import { Modal } from '@/components/ui/Modal';
import { formatPhone, formatClockTime, leadDisplayName, localIsoDate, toE164 } from '@/lib/utils';
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

const KIND_STYLE: Record<CalendarItem['kind'], { dot: string; label: string; pill: string }> = {
  call: { dot: 'bg-primary', label: 'Call Scheduled', pill: 'bg-primary/15 text-primary' },
  followup: { dot: 'bg-accent', label: 'Follow-up', pill: 'bg-accent/15 text-accent' },
  task: { dot: 'bg-info', label: 'Task', pill: 'bg-info/15 text-info' },
};

/** One row inside the day popup — same actions as the compact card row, but
 * with the item's type spelled out as a pill (Task / Follow-up / Call
 * Scheduled) instead of leaving it to a small color-coded dot. A call or
 * follow-up with a real lead attached also gets Call/Text quick actions —
 * same handoff Kanban's own card buttons use (Zoom's deep link for the
 * call, the lead's SMS tab for text) — so acting on it doesn't require
 * leaving the popup to open the lead first. */
function DayDetailRow({
  item,
  onToggleTask,
  onCompleteCall,
  onCall,
  onText,
}: {
  item: CalendarItem;
  onToggleTask: (id: string, completed: boolean) => void;
  onCompleteCall: (lead: Lead) => void;
  onCall: (lead: Lead) => void;
  onText: (lead: Lead) => void;
}) {
  const style = KIND_STYLE[item.kind];
  const showQuickActions = (item.kind === 'call' || item.kind === 'followup') && !!item.lead;
  return (
    <div className="rounded-lg border border-border-2 bg-surface-3 px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        {item.kind === 'task' && item.taskId && (
          <button
            onClick={() => onToggleTask(item.taskId!, !item.completed)}
            className="shrink-0 text-text-3 hover:text-success"
            title={item.completed ? 'Mark incomplete' : 'Mark complete'}
          >
            {item.completed ? <CheckSquare size={17} /> : <Square size={17} />}
          </button>
        )}
        {item.kind === 'call' && item.lead && (
          <button
            onClick={() => onCompleteCall(item.lead!)}
            className="shrink-0 text-text-3 hover:text-success"
            title="Mark this call completed"
          >
            <Circle size={17} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${style.pill}`}>{style.label}</span>
            {item.overdue && <span className="shrink-0 rounded-full bg-danger-dim px-1.5 py-0.5 text-[10px] font-semibold text-danger">Overdue</span>}
          </div>
          {item.href ? (
            <Link to={item.href} className={`mt-0.5 block truncate text-[13px] font-medium hover:underline ${item.completed ? 'text-text-3 line-through' : 'text-text'}`}>
              {item.title}
            </Link>
          ) : (
            <div className={`mt-0.5 truncate text-[13px] font-medium ${item.completed ? 'text-text-3 line-through' : 'text-text'}`}>{item.title}</div>
          )}
          {item.sub && <div className="mt-0.5 truncate text-[11px] text-text-3">"{item.sub}"</div>}
        </div>
        <span className="shrink-0 text-[12px] font-medium text-text-2">{item.time ? formatClockTime(item.time) : 'All day'}</span>
      </div>
      {showQuickActions && (
        <div className="mt-2 flex gap-1.5">
          <button
            onClick={() => onCall(item.lead!)}
            className="flex flex-1 items-center justify-center gap-1 rounded-md bg-success/15 py-1.5 text-[11.5px] font-semibold text-success transition-colors hover:bg-success/25"
          >
            <PhoneCall size={11} /> Call
          </button>
          <button
            onClick={() => onText(item.lead!)}
            className="flex flex-1 items-center justify-center gap-1 rounded-md bg-primary/15 py-1.5 text-[11.5px] font-semibold text-primary transition-colors hover:bg-primary/25"
          >
            <MessageSquare size={11} /> Text
          </button>
        </div>
      )}
    </div>
  );
}

/** Opened by clicking a day's header — everything due that day, clearly
 * labeled by type, without leaving the dashboard the way clicking straight
 * through to a lead does. */
function DayDetailModal({
  day,
  items,
  onClose,
  onToggleTask,
  onCompleteCall,
  onCall,
  onText,
}: {
  day: { iso: string; weekday: string; month: string; dayNum: number; isToday: boolean };
  items: CalendarItem[];
  onClose: () => void;
  onToggleTask: (id: string, completed: boolean) => void;
  onCompleteCall: (lead: Lead) => void;
  onCall: (lead: Lead) => void;
  onText: (lead: Lead) => void;
}) {
  const fullDate = new Date(`${day.iso}T00:00:00`);
  const title = fullDate.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <Modal open onClose={onClose} title={day.isToday ? `Today — ${title}` : title} width="sm">
      {items.length === 0 ? (
        <p className="text-[13px] text-text-3">Nothing due this day.</p>
      ) : (
        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {items.map((item) => (
            <DayDetailRow key={item.id} item={item} onToggleTask={onToggleTask} onCompleteCall={onCompleteCall} onCall={onCall} onText={onText} />
          ))}
        </div>
      )}
    </Modal>
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
  const navigate = useNavigate();
  const { data: tasks = [] } = useTasks(userId);
  const toggleTask = useToggleTask();
  const addActivity = useAddActivity();
  const [completingCall, setCompletingCall] = useState<Lead | null>(null);
  const [openDayIso, setOpenDayIso] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Same handoff Kanban's own Call/Text card buttons use — Zoom's documented
  // deep link actually places the call (a plain tel: link would launch
  // whatever the OS has registered instead of Zoom Phone specifically), and
  // "Text" just opens the lead's own SMS tab rather than composing here.
  const handleCall = useCallback(
    (lead: Lead) => {
      addActivity.mutate({ leadId: lead.id, type: 'call', body: 'Quick call logged from Calendar' });
      const e164 = toE164(lead.phone);
      if (e164) window.location.href = `zoomphonecall://${e164}`;
    },
    [addActivity],
  );
  const handleText = useCallback((lead: Lead) => navigate(`/leads/${lead.id}?tab=sms`), [navigate]);

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
        dow: d.getDay(), // 0 = Sunday
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
        lead,
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

    // Standing reminder, not a real DB task — Bulk SMS runs 6 days a week
    // and never on Sunday (see send-sms's withinSendWindow, which actually
    // enforces that at send time), so this shows on every day except Sunday
    // rather than needing a recurring row someone has to keep creating.
    for (const d of days) {
      if (d.dow === 0) continue;
      map.get(d.iso)!.push({
        id: `bulk-sms-reminder-${d.iso}`,
        kind: 'task',
        time: null,
        title: 'Run Bulk SMS',
        href: '/bulk-sms',
        overdue: false,
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
          const taskCount = items.filter((i) => i.kind === 'task').length;
          // "Calls" bundles Scheduled Calls and Follow-ups together — both
          // mean the same thing at a glance: someone to call that day. The
          // popup (opened by clicking the card) still tells them apart.
          const callCount = items.filter((i) => i.kind === 'call' || i.kind === 'followup').length;
          return (
            <button
              key={d.iso}
              onClick={() => setOpenDayIso(d.iso)}
              className={`shrink-0 rounded-lg border text-left transition-colors ${
                d.isToday
                  ? 'border-primary bg-primary/10 ring-1 ring-primary/40 hover:bg-primary/15'
                  : 'border-border-2 bg-surface-3 hover:bg-surface-2'
              }`}
              style={{ width: DAY_COLUMN_WIDTH, scrollSnapAlign: 'start' }}
              title="View everything due this day"
            >
              <div className={`flex items-center gap-2 border-b px-2.5 py-1.5 ${d.isToday ? 'border-primary/30' : 'border-border-2'}`}>
                {d.isToday ? (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-bold text-white shadow-[0_0_0_3px] shadow-primary/20">
                    {d.dayNum}
                  </span>
                ) : null}
                <div>
                  <div className={`text-[10px] font-semibold uppercase tracking-wide ${d.isToday ? 'text-primary' : 'text-text-3'}`}>
                    {d.isToday ? 'Today' : d.weekday}
                  </div>
                  {!d.isToday && <div className="text-[14px] font-bold text-text">{d.month} {d.dayNum}</div>}
                  {d.isToday && <div className="text-[11px] font-medium text-primary/80">{d.month}</div>}
                </div>
              </div>
              <div className="space-y-1 p-1.5">
                <div className={`flex items-center justify-between rounded-md px-2 py-1 ${taskCount > 0 ? 'bg-info/15' : 'bg-surface-2'}`}>
                  <span className={`flex items-center gap-1 text-[11px] font-medium ${taskCount > 0 ? 'text-info' : 'text-text-3'}`}>
                    <ListChecks size={11} /> Tasks
                  </span>
                  <span className={`text-[12px] font-bold ${taskCount > 0 ? 'text-info' : 'text-text-3'}`}>{taskCount}</span>
                </div>
                <div className={`flex items-center justify-between rounded-md px-2 py-1 ${callCount > 0 ? 'bg-primary/15' : 'bg-surface-2'}`}>
                  <span className={`flex items-center gap-1 text-[11px] font-medium ${callCount > 0 ? 'text-primary' : 'text-text-3'}`}>
                    <PhoneCall size={11} /> Calls
                  </span>
                  <span className={`text-[12px] font-bold ${callCount > 0 ? 'text-primary' : 'text-text-3'}`}>{callCount}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {completingCall && <MarkCallCompleteModal lead={completingCall} onClose={() => setCompletingCall(null)} />}

      {openDayIso && (
        <DayDetailModal
          day={days.find((d) => d.iso === openDayIso)!}
          items={itemsByDay.get(openDayIso) ?? []}
          onClose={() => setOpenDayIso(null)}
          onToggleTask={(id, completed) => toggleTask.mutate({ id, completed })}
          onCompleteCall={(lead) => {
            setOpenDayIso(null);
            setCompletingCall(lead);
          }}
          onCall={handleCall}
          onText={handleText}
        />
      )}
    </div>
  );
}
