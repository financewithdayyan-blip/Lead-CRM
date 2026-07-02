import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, CheckSquare, Phone, Target, X } from 'lucide-react';
import { useLeads } from '@/hooks/useLeads';
import { useTasks, useToggleTask } from '@/hooks/useTasks';
import { useTodayCalledLeadIds } from '@/hooks/useActivities';
import { useAuth } from '@/contexts/AuthContext';
import { formatPhone, localIsoDate } from '@/lib/utils';

interface Props {
  onClose: () => void;
}

export function DailyBriefingModal({ onClose }: Props) {
  const { session, profile } = useAuth();
  const userId = session!.user.id;
  const todayIso = localIsoDate(new Date());

  const { data: leads = [] } = useLeads();
  const { data: tasks = [] } = useTasks();
  const { data: calledIds = new Set<string>() } = useTodayCalledLeadIds(userId);
  const toggleTask = useToggleTask();

  const dailyGoal = profile?.dailyGoal ?? 20;
  const callsToday = calledIds.size;
  const goalPct = Math.min(100, Math.round((callsToday / dailyGoal) * 100));
  const goalColor =
    callsToday >= dailyGoal ? '#10b981' : goalPct >= 70 ? '#4f46e5' : goalPct >= 40 ? '#f59e0b' : '#ef4444';

  const followUps = useMemo(
    () =>
      leads
        .filter((l) => l.nextFollowUp && l.nextFollowUp <= todayIso)
        .sort((a, b) => (a.nextFollowUp ?? '').localeCompare(b.nextFollowUp ?? '')),
    [leads, todayIso],
  );

  const pendingTasks = useMemo(
    () =>
      tasks
        .filter((t) => !t.completed)
        .sort((a, b) => {
          if (!a.dueDate && !b.dueDate) return 0;
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return a.dueDate.localeCompare(b.dueDate);
        }),
    [tasks],
  );

  function followUpLabel(iso: string) {
    if (iso < todayIso) return { text: 'Overdue', color: '#ef4444' };
    return { text: 'Today', color: '#f59e0b' };
  }

  function taskDueLabel(iso: string | null) {
    if (!iso) return null;
    if (iso < todayIso) return { text: 'Overdue', color: '#ef4444' };
    if (iso === todayIso) return { text: 'Due today', color: '#f59e0b' };
    return { text: `Due ${iso}`, color: 'var(--color-text-3)' };
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl shadow-black/30">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-text">Today's Briefing</h2>
            <p className="text-[12px] text-text-3">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-3 hover:bg-surface-3 hover:text-text"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto p-5">

          {/* Daily Call Target */}
          <div className="rounded-xl border border-border bg-surface-2 p-4">
            <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
              <Target size={12} /> Daily Call Target
            </div>
            <div className="flex items-end justify-between">
              <div>
                <span className="text-2xl font-bold" style={{ color: goalColor }}>
                  {callsToday}
                </span>
                <span className="ml-1.5 text-[14px] text-text-3">/ {dailyGoal} calls</span>
              </div>
              <span className="text-[12px] font-semibold" style={{ color: goalColor }}>
                {callsToday >= dailyGoal ? 'Goal reached!' : `${goalPct}%`}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${goalPct}%`, background: goalColor }}
              />
            </div>
          </div>

          {/* Follow-Ups */}
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
              <CalendarClock size={12} /> Follow-Ups Due
              {followUps.length > 0 && (
                <span className="rounded-full bg-danger/10 px-1.5 py-0.5 text-[10px] font-bold text-danger">
                  {followUps.length}
                </span>
              )}
            </div>
            {followUps.length === 0 ? (
              <div className="rounded-xl border border-border bg-surface-2 px-4 py-3 text-[13px] text-text-3">
                No follow-ups due today.
              </div>
            ) : (
              <div className="space-y-1.5">
                {followUps.map((l) => {
                  const label = followUpLabel(l.nextFollowUp!);
                  const address = [l.address, l.city, l.state].filter(Boolean).join(', ');
                  return (
                    <Link
                      key={l.id}
                      to={`/leads/${l.id}`}
                      onClick={onClose}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3 hover:border-primary"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-semibold text-text">
                            {l.firstName} {l.lastName}
                          </span>
                          <span
                            className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                            style={{ backgroundColor: `${label.color}18`, color: label.color }}
                          >
                            {label.text}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-3 text-[12px] text-text-3">
                          <span className="flex shrink-0 items-center gap-1">
                            <Phone size={11} /> {formatPhone(l.phone)}
                          </span>
                          {address && <span className="truncate">{address}</span>}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tasks */}
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
              <CheckSquare size={12} /> Tasks
              {pendingTasks.length > 0 && (
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                  {pendingTasks.length}
                </span>
              )}
            </div>
            {pendingTasks.length === 0 ? (
              <div className="rounded-xl border border-border bg-surface-2 px-4 py-3 text-[13px] text-text-3">
                No pending tasks.
              </div>
            ) : (
              <div className="space-y-1.5">
                {pendingTasks.map((t) => {
                  const dueLabel = taskDueLabel(t.dueDate);
                  const lead = t.leadId ? leads.find((l) => l.id === t.leadId) : null;
                  return (
                    <div
                      key={t.id}
                      className="flex items-start gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3"
                    >
                      <input
                        type="checkbox"
                        checked={t.completed}
                        onChange={(e) => toggleTask.mutate({ id: t.id, completed: e.target.checked })}
                        className="mt-0.5 shrink-0 accent-primary"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium text-text">{t.title}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px]">
                          {dueLabel && (
                            <span style={{ color: dueLabel.color }}>{dueLabel.text}</span>
                          )}
                          {lead && (
                            <Link
                              to={`/leads/${lead.id}`}
                              onClick={onClose}
                              className="text-primary hover:underline"
                            >
                              {lead.firstName} {lead.lastName}
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="border-t border-border px-5 py-4">
          <button onClick={onClose} className="btn btn-primary w-full justify-center">
            Got it — start calling
          </button>
        </div>
      </div>
    </div>
  );
}
