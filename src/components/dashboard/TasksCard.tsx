import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calculator, ChevronDown, ChevronRight, ListChecks, MessageSquare, PhoneCall, RotateCw } from 'lucide-react';
import { useTasks, useToggleTask } from '@/hooks/useTasks';
import { useFollowupLeads, useNoPacketLeads, useSmsCampaignRanToday } from '@/hooks/useDashboardTaskSummary';
import { formatDate, localIsoDate } from '@/lib/utils';
import type { Lead } from '@/types/domain';

/** One of the four daily, aggregate rows — a count and an expandable list of
 * the actual leads behind it, rather than a flat row per lead. */
function TaskCategory({
  icon: Icon,
  label,
  count,
  emptyLabel,
  children,
}: {
  icon: typeof ListChecks;
  label: string;
  count: number;
  emptyLabel: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const hasItems = count > 0 && !!children;

  return (
    <div className="rounded-md border border-border-2 bg-surface-3">
      <button
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        onClick={() => hasItems && setOpen((o) => !o)}
        disabled={!hasItems}
      >
        <span className="flex items-center gap-2 text-[13px] text-text">
          <Icon size={14} className="shrink-0 text-text-3" />
          {label}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <span
            className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
              count > 0 ? 'bg-warning-dim text-warning' : 'bg-surface-2 text-text-3'
            }`}
          >
            {count}
          </span>
          {hasItems && (open ? <ChevronDown size={13} className="text-text-3" /> : <ChevronRight size={13} className="text-text-3" />)}
        </span>
      </button>
      {count === 0 && <p className="px-3 pb-2 text-[12px] text-text-3">{emptyLabel}</p>}
      {open && hasItems && <div className="space-y-1 border-t border-border-2 px-3 py-2">{children}</div>}
    </div>
  );
}

/** Four daily, purpose-level items instead of a flat, ever-growing list of
 * one row per lead: run today's SMS campaign, catch up on stalled leads,
 * work today's scheduled calls, and run numbers on qualified leads nobody's
 * gotten to yet. Each count is computed fresh from live lead/business state
 * (see useDashboardTaskSummary and 0080_daily_task_summary.sql) rather than
 * a task row someone has to remember to create and clear — a stalled lead
 * drops off "Do followups" the moment any activity happens on it, no manual
 * bookkeeping required. Hand-added tasks (from a lead's own page) still show
 * below as their own flat list, since those are genuinely one-off, not the
 * systemic pile-up this replaced. */
export function TasksCard({ userId, leads }: { userId: string; leads: Lead[] }) {
  const { data: tasks = [] } = useTasks(userId);
  const toggleTask = useToggleTask();
  const { data: followupLeads = [] } = useFollowupLeads();
  const { data: noPacketLeads = [] } = useNoPacketLeads();
  const { data: campaignRanToday } = useSmsCampaignRanToday();
  const todayStr = localIsoDate(new Date());

  const scheduledCalls = useMemo(() => leads.filter((l) => !!l.scheduledCallbackAt), [leads]);

  const manualOpen = useMemo(
    () =>
      tasks
        .filter((t) => !t.completed && !t.autoCreated)
        .sort((a, b) => (a.dueDate ?? '9999-99-99').localeCompare(b.dueDate ?? '9999-99-99')),
    [tasks],
  );

  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text">
          <ListChecks size={14} /> Tasks
        </h3>
      </div>

      <div className="space-y-1.5">
        <TaskCategory
          icon={MessageSquare}
          label="Run today's SMS campaign"
          count={campaignRanToday ? 0 : 1}
          emptyLabel="Sent today"
        >
          <Link to="/kanban" className="text-[12px] text-primary hover:underline">
            Go select leads and send →
          </Link>
        </TaskCategory>

        <TaskCategory
          icon={RotateCw}
          label="Do followups"
          count={followupLeads.length}
          emptyLabel="Nothing's gone quiet — every active lead has recent activity."
        >
          {followupLeads.map((l) => (
            <Link key={l.id} to={`/leads/${l.id}`} className="block truncate text-[12px] text-text hover:text-primary hover:underline">
              {l.firstName} {l.lastName}
            </Link>
          ))}
        </TaskCategory>

        <TaskCategory
          icon={PhoneCall}
          label="Do scheduled calls"
          count={scheduledCalls.length}
          emptyLabel="Nothing scheduled — see Scheduled Calls below once one comes in."
        >
          {scheduledCalls.map((l) => (
            <Link key={l.id} to={`/leads/${l.id}`} className="block truncate text-[12px] text-text hover:text-primary hover:underline">
              {l.firstName} {l.lastName}
            </Link>
          ))}
        </TaskCategory>

        <TaskCategory
          icon={Calculator}
          label="Run numbers for qualified leads"
          count={noPacketLeads.length}
          emptyLabel="Every qualified lead already has a deal packet."
        >
          {noPacketLeads.map((l) => (
            <Link key={l.id} to={`/leads/${l.id}`} className="block truncate text-[12px] text-text hover:text-primary hover:underline">
              {l.firstName} {l.lastName}
            </Link>
          ))}
        </TaskCategory>
      </div>

      {manualOpen.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-border-2 pt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Added by hand</div>
          {manualOpen.map((t) => {
            const overdue = !!t.dueDate && t.dueDate < todayStr;
            const isToday = t.dueDate === todayStr;
            return (
              <div
                key={t.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border-2 bg-surface-3 px-3 py-2 text-[13px]"
              >
                <label className="flex min-w-0 flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={t.completed}
                    onChange={(e) => toggleTask.mutate({ id: t.id, completed: e.target.checked })}
                  />
                  {t.leadId ? (
                    <Link to={`/leads/${t.leadId}`} className="truncate text-text hover:underline">
                      {t.title}
                    </Link>
                  ) : (
                    <span className="truncate text-text">{t.title}</span>
                  )}
                </label>
                {t.dueDate && (
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                      overdue ? 'bg-danger-dim text-danger' : isToday ? 'bg-warning-dim text-warning' : 'bg-surface-2 text-text-3'
                    }`}
                  >
                    {overdue ? `Overdue · ${formatDate(t.dueDate)}` : isToday ? 'Today' : formatDate(t.dueDate)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
