import { useState } from 'react';
import { CheckSquare, Plus, Trash2 } from 'lucide-react';
import { CardHeader } from '@/components/ui/CardHeader';
import { useTasks, useCreateTask, useToggleTask, useDeleteTask } from '@/hooks/useTasks';
import { daysUntil, formatDate } from '@/lib/utils';

function dueDateLabel(dueDate: string | null): string | null {
  if (!dueDate) return null;
  const diff = daysUntil(dueDate);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff > 1 && diff <= 7) return 'This week';
  if (diff < 0) return `Overdue · ${formatDate(dueDate)}`;
  return formatDate(dueDate);
}

export function TasksSidebarCard({ leadId, ownerId }: { leadId: string; ownerId: string }) {
  const { data: allTasks = [] } = useTasks(ownerId);
  const tasks = allTasks.filter((t) => t.leadId === leadId);
  const createTask = useCreateTask();
  const toggleTask = useToggleTask();
  const deleteTask = useDeleteTask();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');

  function handleAdd() {
    if (!title.trim()) return;
    createTask.mutate(
      { leadId, title: title.trim(), dueDate: null, userId: ownerId },
      { onSuccess: () => { setTitle(''); setAdding(false); } },
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2">
        <CardHeader icon={CheckSquare} title="Tasks for this lead" />
        <button className="text-text-3 hover:text-primary" onClick={() => setAdding((v) => !v)} title="Add task">
          <Plus size={15} />
        </button>
      </div>

      {adding && (
        <div className="mt-3 flex gap-1.5">
          <input
            autoFocus
            className="input flex-1"
            placeholder="New task…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <button className="btn btn-primary !px-2.5" onClick={handleAdd} disabled={createTask.isPending}>
            Add
          </button>
        </div>
      )}

      <div className="mt-3 space-y-2">
        {tasks.length === 0 && !adding && <div className="text-[13px] text-text-3">No tasks for this lead.</div>}
        {tasks.map((t) => {
          const label = dueDateLabel(t.dueDate);
          return (
            <div key={t.id} className="group flex items-start gap-2">
              <input
                type="checkbox"
                checked={t.completed}
                onChange={(e) => toggleTask.mutate({ id: t.id, completed: e.target.checked })}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary"
              />
              <div className="min-w-0 flex-1">
                <div className={`text-[13px] ${t.completed ? 'text-text-3 line-through' : 'text-text'}`}>{t.title}</div>
                {label && <div className="text-[11px] text-text-3">{label}</div>}
              </div>
              <button
                className="shrink-0 text-text-3 opacity-0 hover:text-danger group-hover:opacity-100"
                onClick={() => deleteTask.mutate(t.id)}
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
