import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { useOnlineUserIds } from './PresenceContext';
import { useTasks, useToggleTask } from '@/hooks/useTasks';
import { useLeads, useUpdateLead } from '@/hooks/useLeads';
import { useTeamTodaySummaries } from '@/hooks/useDailySummaries';
import { useAcceptLeadShare, useDeclineLeadShare, usePendingLeadShares } from '@/hooks/useLeadShares';
import { useTeamMembers } from '@/hooks/useTeam';
import { useTeamTodaySessions } from '@/hooks/useAttendance';
import type { DailySummary, Lead, LeadShare, Task } from '@/types/domain';
import { daysUntil, localIsoDate } from '@/lib/utils';
import { loadReadIds, saveReadIds } from '@/lib/notificationReads';

const AUCTION_MILESTONES = [20, 10, 7];

interface AuctionAlert {
  lead: Lead;
  daysRemaining: number;
  milestone: number;
}

interface PresenceEvent {
  id: string;
  type: 'online' | 'offline';
  memberName: string;
  at: string;
}

interface NotificationsContextValue {
  isAdmin: boolean;
  todayIso: string;
  dueTasks: Task[];
  dueFollowUps: Lead[];
  teamSummaries: (DailySummary & { memberName: string })[];
  pendingShares: (LeadShare & { leadName: string; fromName: string })[];
  auctionAlerts: AuctionAlert[];
  presenceEvents: PresenceEvent[];
  toggleTask: ReturnType<typeof useToggleTask>;
  acceptShare: ReturnType<typeof useAcceptLeadShare>;
  declineShare: ReturnType<typeof useDeclineLeadShare>;
  acknowledgeAuctionAlert: (leadId: string, milestone: number) => void;
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
  const { data: pendingShares = [] } = usePendingLeadShares();
  const { data: teamMembers = [] } = useTeamMembers();
  const { data: teamSessions = [] } = useTeamTodaySessions();
  const onlineIds = useOnlineUserIds();
  const toggleTask = useToggleTask();
  const acceptShare = useAcceptLeadShare();
  const declineShare = useDeclineLeadShare();
  const updateLead = useUpdateLead();

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
  const auctionAlerts = useMemo(() => {
    const alerts: AuctionAlert[] = [];
    for (const lead of leads) {
      if (!lead.auctionDate) continue;
      const daysRemaining = daysUntil(lead.auctionDate);
      if (daysRemaining < 0) continue;
      const due = AUCTION_MILESTONES.filter((m) => daysRemaining <= m && !lead.auctionMilestonesNotified.includes(m));
      if (due.length === 0) continue;
      alerts.push({ lead, daysRemaining, milestone: Math.min(...due) });
    }
    return alerts.sort((a, b) => a.daysRemaining - b.daysRemaining);
  }, [leads]);

  const presenceEvents = useMemo(() => {
    const events: PresenceEvent[] = [];
    for (const s of teamSessions) {
      const member = teamMembers.find((m) => m.memberId === s.userId);
      const memberName = member ? member.member.fullName || member.member.email : 'A team member';
      events.push({ id: `presence_on:${s.id}`, type: 'online', memberName, at: s.startedAt });
      if (!onlineIds.has(s.userId)) {
        events.push({ id: `presence_off:${s.id}`, type: 'offline', memberName, at: s.endedAt });
      }
    }
    return events.sort((a, b) => b.at.localeCompare(a.at));
  }, [teamSessions, teamMembers, onlineIds]);

  const allIds = useMemo(
    () => [
      ...dueTasks.map((t) => `task:${t.id}`),
      ...dueFollowUps.map((l) => `followup:${l.id}`),
      ...auctionAlerts.map((a) => `auction:${a.lead.id}:${a.milestone}`),
      ...presenceEvents.map((p) => p.id),
      ...(isAdmin ? teamSummaries.map((s) => `summary:${s.id}`) : []),
    ],
    [dueTasks, dueFollowUps, auctionAlerts, presenceEvents, teamSummaries, isAdmin],
  );
  const unreadCount = allIds.filter((id) => !readIds.has(id)).length + (isAdmin ? pendingShares.length : 0);

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
    auctionAlerts.forEach((a) => acknowledgeAuctionAlert(a.lead.id, a.milestone));
  }

  function acknowledgeAuctionAlert(leadId: string, milestone: number) {
    markRead([`auction:${leadId}:${milestone}`]);
    const lead = leads.find((l) => l.id === leadId);
    if (lead && !lead.auctionMilestonesNotified.includes(milestone)) {
      updateLead.mutate({ id: leadId, auctionMilestonesNotified: [...lead.auctionMilestonesNotified, milestone] });
    }
  }

  return (
    <NotificationsContext.Provider
      value={{
        isAdmin,
        todayIso,
        dueTasks,
        dueFollowUps,
        teamSummaries,
        pendingShares,
        auctionAlerts,
        presenceEvents,
        toggleTask,
        acceptShare,
        declineShare,
        acknowledgeAuctionAlert,
        readIds,
        unreadCount,
        markRead,
        markAllRead,
      }}
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
