import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ListChecks } from 'lucide-react';
import { useTasks, useToggleTask } from '@/hooks/useTasks';
import { formatDate, localIsoDate } from '@/lib/utils';

const MAX_ROWS = 8;

/** Every open task across the whole pipeline — both ones an admin added by
 * hand and ones the AI created on its own (a qualified handoff, a scheduled
 * callback, a price-only decline worth revisiting) — sorted soonest-due
 * first so the ones with no due date at all don't bury the ones that do. */
export function TasksCard({ userId }: { userId: string }) {
  const { data: tasks = [] } = useTasks(userId);
  const toggleTask = useToggleTask();
  const todayStr = localIsoDate(new Date());

  const open = useMemo(
    () =>
      tasks
        .filter((t) => !t.completed)
        .sort((a, b) => (a.dueDate ?? '9999-99-99').localeCompare(b.dueDate ?? '9999-99-99')),
    [tasks],
  );

  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text">
          <ListChecks size={14} /> Tasks
        </h3>
        {open.length > 0 && <span className="text-[11px] text-text-3">{open.length} open</span>}
      </div>

      {open.length === 0 ? (
        <p className="text-[13px] text-text-3">
          Nothing open — tasks show up here whether you add them on a lead or the AI creates one automatically.
        </p>
      ) : (
        <div className="space-y-1.5">
          {open.slice(0, MAX_ROWS).map((t) => {
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
          {open.length > MAX_ROWS && <div className="pt-1 text-center text-[11px] text-text-3">+{open.length - MAX_ROWS} more</div>}
        </div>
      )}
    </div>
  );
}
