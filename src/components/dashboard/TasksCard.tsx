import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ListChecks } from 'lucide-react';
import { useTasks, useToggleTask } from '@/hooks/useTasks';
import { formatDate, localIsoDate } from '@/lib/utils';

/** Only ever shows tasks added by hand from a lead's own Tasks tab — no
 * automatic "stalled lead" or "no deal packet" heuristics guessing at what
 * needs attention. Those tried to be smart and just added noise; a real
 * task list is whatever was actually put on it. */
export function TasksCard({ userId }: { userId: string }) {
  const { data: tasks = [] } = useTasks(userId);
  const toggleTask = useToggleTask();
  const todayStr = localIsoDate(new Date());

  const open = useMemo(
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

      {open.length === 0 ? (
        <p className="text-[12px] text-text-3">No tasks yet — add one from a lead's Tasks tab.</p>
      ) : (
        <div className="space-y-1.5">
          {open.map((t) => {
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
