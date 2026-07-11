import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { useTasks, useToggleTask } from '@/hooks/useTasks';
import { useLeads, useUpdateLead } from '@/hooks/useLeads';
import { useTeamWeeklySummaries } from '@/hooks/useDailySummaries';
import {
  useAcceptLeadShare,
  useDeclineLeadShare,
  usePendingLeadShares,
  usePendingIncomingShares,
  useAcceptAdminLeadShare,
  useDeclineAdminLeadShare,
} from '@/hooks/useLeadShares';
import { useTeamMembers } from '@/hooks/useTeam';
import { useTeamWeeklySessions } from '@/hooks/useAttendance';
import { useAdminNotesOnMyLeads, type AdminNoteNotif } from '@/hooks/useActivities';
import { useDbNotifications, useMarkAllDbNotificationsRead, useMarkDbNotificationsRead, type DbNotification } from '@/hooks/useDbNotifications';
import { useWebLeads, useMarkWebLeadRead, useMarkAllWebLeadsRead, type WebLead } from '@/hooks/useWebLeads';
import type { DailySummary, Lead, LeadShare, Task } from '@/types/domain';
import { daysUntil, localIsoDate } from '@/lib/utils';
import { loadReadIds, saveReadIds } from '@/lib/notificationReads';

// Tier boundary days — the points at which client-side auction alerts fire.
const AUCTION_MILESTONES = [30, 14, 7, 3];

interface AuctionAlert {
  lead: Lead;
  daysRemaining: number;
  milestone: number;
}

interface SessionEvent {
  id: string;
  memberName: string;
  at: string;
}

interface NotificationsContextValue {
  isAdmin: boolean;
  todayIso: string;
  weekFromNowIso: string;
  dueTasks: Task[];
  dueFollowUps: Lead[];
  teamSummaries: (DailySummary & { memberName: string })[];
  pendingShares: (LeadShare & { leadName: string; fromName: string })[];
  pendingIncomingShares: (LeadShare & { leadName: string; fromName: string; toName: string })[];
  auctionAlerts: AuctionAlert[];
  sessionEvents: SessionEvent[];
  adminNotes: AdminNoteNotif[];
  dbAlerts: DbNotification[];
  webLeads: WebLead[];
  markWebLeadRead: (id: string) => void;
  markAllWebLeadsRead: () => void;
  toggleTask: ReturnType<typeof useToggleTask>;
  acceptShare: ReturnType<typeof useAcceptLeadShare>;
  declineShare: ReturnType<typeof useDeclineLeadShare>;
  acceptAdminShare: ReturnType<typeof useAcceptAdminLeadShare>;
  declineAdminShare: ReturnType<typeof useDeclineAdminLeadShare>;
  acknowledgeAuctionAlert: (leadId: string, milestone: number) => void;
  markDbAlertRead: (ids: string[]) => void;
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
  const weekFromNow = new Date();
  weekFromNow.setDate(weekFromNow.getDate() + 7);
  const weekFromNowIso = localIsoDate(weekFromNow);

  const [readIds, setReadIds] = useState<Set<string>>(() => loadReadIds(userId, todayIso));

  const { data: tasks = [] } = useTasks();
  const { data: leads = [] } = useLeads();
  const { data: teamSummaries = [] } = useTeamWeeklySummaries();
  const { data: pendingShares = [] } = usePendingLeadShares();
  const { data: pendingIncomingShares = [] } = usePendingIncomingShares();
  const { data: teamMembers = [] } = useTeamMembers();
  const { data: teamSessions = [] } = useTeamWeeklySessions();
  const { data: adminNotes = [] } = useAdminNotesOnMyLeads();
  const { data: dbAlerts = [] } = useDbNotifications();
  const { data: webLeads = [] } = useWebLeads(isAdmin);
  const markDbRead = useMarkDbNotificationsRead();
  const markAllDbRead = useMarkAllDbNotificationsRead();
  const markWebLeadReadMutation = useMarkWebLeadRead();
  const markAllWebLeadsReadMutation = useMarkAllWebLeadsRead();
  const toggleTask = useToggleTask();
  const acceptShare = useAcceptLeadShare();
  const declineShare = useDeclineLeadShare();
  const acceptAdminShare = useAcceptAdminLeadShare();
  const declineAdminShare = useDeclineAdminLeadShare();
  const updateLead = useUpdateLead();

  // Tasks due within 7 days (overdue + today + this week)
  const dueTasks = useMemo(
    () =>
      tasks
        .filter((t) => !t.completed && t.dueDate && t.dueDate <= weekFromNowIso)
        .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '')),
    [tasks, weekFromNowIso],
  );

  // Follow-ups due within 7 days (overdue + today + this week)
  const dueFollowUps = useMemo(
    () =>
      leads
        .filter((l) => l.nextFollowUp && l.nextFollowUp <= weekFromNowIso)
        .sort((a, b) => (a.nextFollowUp ?? '').localeCompare(b.nextFollowUp ?? '')),
    [leads, weekFromNowIso],
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

  // Only show session-start events (no online/offline spam)
  const sessionEvents = useMemo(() => {
    return teamSessions.map((s) => {
      const member = teamMembers.find((m) => m.memberId === s.userId);
      const memberName = member ? member.member.fullName || member.member.email : 'A team member';
      return { id: `session:${s.id}`, memberName, at: s.startedAt };
    });
  }, [teamSessions, teamMembers]);

  const allIds = useMemo(
    () => [
      ...dueTasks.map((t) => `task:${t.id}`),
      ...dueFollowUps.map((l) => `followup:${l.id}`),
      ...auctionAlerts.map((a) => `auction:${a.lead.id}:${a.milestone}`),
      ...sessionEvents.map((e) => e.id),
      ...(isAdmin ? teamSummaries.map((s) => `summary:${s.id}`) : []),
      ...adminNotes.map((n) => `adminnote:${n.id}`),
    ],
    [dueTasks, dueFollowUps, auctionAlerts, sessionEvents, teamSummaries, isAdmin, adminNotes],
  );
  const dbUnreadCount = dbAlerts.filter((n) => !n.isRead).length;
  const webLeadsUnread = isAdmin ? webLeads.filter((l) => !l.isRead).length : 0;
  const unreadCount =
    allIds.filter((id) => !readIds.has(id)).length +
    (isAdmin ? pendingShares.length : pendingIncomingShares.length) +
    dbUnreadCount +
    webLeadsUnread;

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
    markAllDbRead.mutate();
    if (isAdmin) markAllWebLeadsReadMutation.mutate();
  }

  function markDbAlertRead(ids: string[]) {
    markDbRead.mutate(ids);
  }

  function markWebLeadRead(id: string) {
    markWebLeadReadMutation.mutate(id);
  }

  function markAllWebLeadsRead() {
    markAllWebLeadsReadMutation.mutate();
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
        weekFromNowIso,
        dueTasks,
        dueFollowUps,
        teamSummaries,
        pendingShares,
        pendingIncomingShares,
        auctionAlerts,
        sessionEvents,
        adminNotes,
        dbAlerts,
        webLeads,
        markWebLeadRead,
        markAllWebLeadsRead,
        toggleTask,
        acceptShare,
        declineShare,
        acceptAdminShare,
        declineAdminShare,
        acknowledgeAuctionAlert,
        markDbAlertRead,
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
