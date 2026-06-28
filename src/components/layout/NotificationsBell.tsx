import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CalendarClock, CheckSquare, ChevronDown, FileText } from 'lucide-react';
import { useTasks, useToggleTask } from '@/hooks/useTasks';
import { useLeads } from '@/hooks/useLeads';
import { useTeamTodaySummaries } from '@/hooks/useDailySummaries';
import { useAuth } from '@/contexts/AuthContext';
import { Modal } from '@/components/ui/Modal';
import { formatDate, localIsoDate } from '@/lib/utils';
import { loadReadIds, saveReadIds } from '@/lib/notificationReads';

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [expandedSummaryId, setExpandedSummaryId] = useState<string | null>(null);
  const { session, profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const userId = session?.user.id ?? '';
  const todayIso = localIsoDate(new Date());

  const [readIds, setReadIds] = useState<Set<string>>(() => loadReadIds(userId, todayIso));

  const { data: tasks = [] } = useTasks();
  const { data: leads = [] } = useLeads();
  const { data: teamSummaries = [] } = useTeamTodaySummaries();
  const toggleTask = useToggleTask();

  const dueTasks = useMemo(
    () =>
      tasks
        .filter((t) => !t.completed && t.dueDate && t.dueDate <= todayIso)
        .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '')),
    [tasks, todayIso],
  );
  const dueFollowUps = useMemo(
    () =>
      leads
        .filter((l) => l.nextFollowUp && l.nextFollowUp <= todayIso)
        .sort((a, b) => (a.nextFollowUp ?? '').localeCompare(b.nextFollowUp ?? '')),
    [leads, todayIso],
  );

  const allIds = useMemo(
    () => [
      ...dueTasks.map((t) => `task:${t.id}`),
      ...dueFollowUps.map((l) => `followup:${l.id}`),
      ...(isAdmin ? teamSummaries.map((s) => `summary:${s.id}`) : []),
    ],
    [dueTasks, dueFollowUps, teamSummaries, isAdmin],
  );
  const unreadCount = allIds.filter((id) => !readIds.has(id)).length;

  function markRead(ids: string[]) {
    setReadIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      saveReadIds(userId, todayIso, next);
      return next;
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Notifications"
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border-2 bg-white text-text-2 hover:bg-surface-3"
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Notifications" width="md">
        {allIds.length === 0 ? (
          <div className="text-center text-[13px] text-text-3">You're all caught up — nothing due today.</div>
        ) : (
          <div className="space-y-4">
            {unreadCount > 0 && (
              <div className="flex justify-end">
                <button className="text-[12px] font-medium text-primary hover:underline" onClick={() => markRead(allIds)}>
                  Mark all as read
                </button>
              </div>
            )}

            {isAdmin && teamSummaries.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
                  <FileText size={12} /> Daily Summaries ({teamSummaries.length})
                </div>
                <div className="space-y-1.5">
                  {teamSummaries.map((s) => {
                    const id = `summary:${s.id}`;
                    const expanded = expandedSummaryId === s.id;
                    const unread = !readIds.has(id);
                    return (
                      <div key={s.id} className="rounded-md border border-border-2 bg-surface-3 p-2.5">
                        <button
                          className="flex w-full items-center justify-between gap-3 text-left"
                          onClick={() => {
                            setExpandedSummaryId(expanded ? null : s.id);
                            markRead([id]);
                          }}
                        >
                          <div className="flex min-w-0 items-center gap-2 text-[13px] text-text">
                            {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                            <span>
                              <span className="font-medium">{s.memberName}</span> submitted their daily summary
                            </span>
                          </div>
                          <ChevronDown size={14} className={`shrink-0 text-text-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                        </button>
                        {expanded && <p className="mt-2 whitespace-pre-wrap text-[13px] text-text-2">{s.summary}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {dueFollowUps.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
                  <CalendarClock size={12} /> Follow-Ups Due ({dueFollowUps.length})
                </div>
                <div className="space-y-1.5">
                  {dueFollowUps.map((l) => {
                    const id = `followup:${l.id}`;
                    const unread = !readIds.has(id);
                    return (
                      <Link
                        key={l.id}
                        to={`/leads/${l.id}`}
                        onClick={() => {
                          markRead([id]);
                          setOpen(false);
                        }}
                        className="flex items-center justify-between gap-3 rounded-md border border-border-2 bg-surface-3 p-2.5 hover:border-primary"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-medium text-text">
                              {l.firstName} {l.lastName}
                            </div>
                            <div className="text-[11px] text-text-3">
                              {formatDate(l.nextFollowUp)}
                              {l.nextFollowUp! < todayIso ? ' · Overdue' : ' · Today'}
                            </div>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {dueTasks.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
                  <CheckSquare size={12} /> Tasks Due ({dueTasks.length})
                </div>
                <div className="space-y-1.5">
                  {dueTasks.map((t) => {
                    const id = `task:${t.id}`;
                    const unread = !readIds.has(id);
                    return (
                      <div key={t.id} className="flex items-center justify-between gap-3 rounded-md border border-border-2 bg-surface-3 p-2.5">
                        <label className="flex min-w-0 items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={t.completed}
                            onChange={(e) => {
                              toggleTask.mutate({ id: t.id, completed: e.target.checked });
                              markRead([id]);
                            }}
                          />
                          {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-medium text-text">{t.title}</div>
                            <div className="text-[11px] text-text-3">
                              {formatDate(t.dueDate)}
                              {t.dueDate! < todayIso ? ' · Overdue' : ' · Today'}
                            </div>
                          </div>
                        </label>
                        {t.leadId && (
                          <Link
                            to={`/leads/${t.leadId}`}
                            onClick={() => {
                              markRead([id]);
                              setOpen(false);
                            }}
                            className="shrink-0 text-[12px] text-primary hover:underline"
                          >
                            View lead
                          </Link>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
