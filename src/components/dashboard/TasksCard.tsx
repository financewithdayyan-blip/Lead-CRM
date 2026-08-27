import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, ChevronDown, ChevronRight, ListChecks, MessageSquare } from 'lucide-react';
import { useTasks, useToggleTask } from '@/hooks/useTasks';
import { useSmsCampaignRanToday } from '@/hooks/useSmsCampaignToday';
import { formatDate, formatPhone, leadDisplayName, localIsoDate } from '@/lib/utils';
import { STAGE_CONFIG, type Lead, type LeadStage } from '@/types/domain';

/** One of the three daily, collapsible rows — a count and an expandable list
 * of what's actually behind it, rather than a flat ever-growing pile. */
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
      {open && hasItems && (
        <div className="max-h-72 space-y-1 overflow-y-auto border-t border-border-2 px-2.5 py-2">{children}</div>
      )}
    </div>
  );
}

/** A lead row for the Followup Scheduled category — name, phone, stage. */
function FollowupLeadRow({ lead }: { lead: Lead }) {
  const stageCfg = STAGE_CONFIG[lead.stage as LeadStage];
  return (
    <Link
      to={`/leads/${lead.id}`}
      className="flex items-center justify-between gap-2 rounded-md border border-border-2 bg-surface px-2.5 py-1.5 text-[12px] hover:border-primary/50"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-text">{leadDisplayName(lead.firstName, lead.lastName) ?? formatPhone(lead.phone)}</div>
        <div className="truncate text-[11px] text-text-3">{formatPhone(lead.phone)}</div>
      </div>
      {stageCfg && (
        <span
          className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
          style={{ backgroundColor: `${stageCfg.color}1f`, color: stageCfg.color }}
        >
          {stageCfg.label}
        </span>
      )}
    </Link>
  );
}

/** Three daily items: today's SMS campaign, leads whose own Next Follow-Up
 * date (set on the lead's Overview tab) has come due, and whatever's been
 * added by hand from a lead's Tasks tab. No stalled-lead or no-packet
 * heuristics guessing at what needs attention — every count here traces to
 * something someone actually did or actually scheduled. */
export function TasksCard({ userId, leads }: { userId: string; leads: Lead[] }) {
  const { data: tasks = [] } = useTasks(userId);
  const toggleTask = useToggleTask();
  const { data: campaignRanToday } = useSmsCampaignRanToday();
  const todayStr = localIsoDate(new Date());

  const leadById = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);

  const followupDue = useMemo(
    () => leads.filter((l) => !!l.nextFollowUp && l.nextFollowUp <= todayStr && l.stage !== 'dead_declined'),
    [leads, todayStr],
  );

  const openTasks = useMemo(
    () => tasks.filter((t) => !t.completed).sort((a, b) => (a.dueDate ?? '9999-99-99').localeCompare(b.dueDate ?? '9999-99-99')),
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
        <TaskCategory icon={MessageSquare} label="Send Daily SMS" count={campaignRanToday ? 0 : 1} emptyLabel="Sent today">
          <Link to="/kanban" className="text-[12px] text-primary hover:underline">
            Go select leads and send →
          </Link>
        </TaskCategory>

        <TaskCategory
          icon={CalendarClock}
          label="Followup Scheduled"
          count={followupDue.length}
          emptyLabel="Nothing due — see a lead's Overview tab to set a Next Follow-Up date."
        >
          {followupDue.map((l) => (
            <FollowupLeadRow key={l.id} lead={l} />
          ))}
        </TaskCategory>

        <TaskCategory
          icon={ListChecks}
          label="Manually Created Tasks"
          count={openTasks.length}
          emptyLabel="No tasks yet — add one from a lead's Tasks tab."
        >
          {openTasks.map((t) => {
            const lead = t.leadId ? leadById.get(t.leadId) : null;
            const leadName = lead ? leadDisplayName(lead.firstName, lead.lastName) : null;
            const overdue = !!t.dueDate && t.dueDate < todayStr;
            const isToday = t.dueDate === todayStr;
            return (
              <div key={t.id} className="flex items-center justify-between gap-2 rounded-md border border-border-2 bg-surface px-2.5 py-1.5 text-[12px]">
                <label className="flex min-w-0 flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={t.completed}
                    onChange={(e) => toggleTask.mutate({ id: t.id, completed: e.target.checked })}
                  />
                  <div className="min-w-0 flex-1">
                    {leadName ? (
                      <>
                        <Link to={`/leads/${t.leadId}`} className="block truncate font-medium text-text hover:underline">
                          {leadName}
                        </Link>
                        <div className="truncate text-[11px] text-text-3">{t.title}</div>
                      </>
                    ) : t.leadId ? (
                      <Link to={`/leads/${t.leadId}`} className="truncate text-text hover:underline">
                        {t.title}
                      </Link>
                    ) : (
                      <span className="truncate text-text">{t.title}</span>
                    )}
                  </div>
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
        </TaskCategory>
      </div>
    </div>
  );
}
