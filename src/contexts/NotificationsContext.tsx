import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { useTasks, useToggleTask } from '@/hooks/useTasks';
import { useLeads } from '@/hooks/useLeads';
import { useTeamTodaySummaries } from '@/hooks/useDailySummaries';
import type { DailySummary, Lead, Task } from '@/types/domain';
import { localIsoDate } from '@/lib/utils';
import { loadReadIds, saveReadIds } from '@/lib/notificationReads';

interface NotificationsContextValue {
  isAdmin: boolean;
  todayIso: string;
  dueTasks: Task[];
  dueFollowUps: Lead[];
  teamSummaries: (DailySummary & { memberName: string })[];
  toggleTask: ReturnType<typeof useToggleTask>;
  readIds: Set<string>;
  unreadCount: number;
  markRead: (ids: string[]) => void;
  markAllRead: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue | undefined>(undefined);

export function NotificationsProvider({ children }: { children: ReactNode }) {
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

  function markAllRead() {
    markRead(allIds);
  }

  return (
    <NotificationsContext.Provider
      value={{ isAdmin, todayIso, dueTasks, dueFollowUps, teamSummaries, toggleTask, readIds, unreadCount, markRead, markAllRead }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotificationsContext() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotificationsContext must be used within NotificationsProvider');
  return ctx;
}
