import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, CalendarClock, CheckSquare, ChevronDown, FileText, Gavel, Share2, X } from 'lucide-react';
import { useNotificationsContext } from '@/contexts/NotificationsContext';
import { STAGE_CONFIG } from '@/types/domain';
import { formatDate } from '@/lib/utils';

const NOTIF_TYPE_CONFIG = {
  summary: { label: 'Daily Summary', color: '#4f46e5' },
  followup: { label: 'Follow-Up', color: '#a78bfa' },
  task: { label: 'Task', color: '#f59e0b' },
  share: { label: 'Shared Lead', color: '#10b981' },
  auction: { label: 'Auction', color: '#ef4444' },
};

function NotifTag({ type }: { type: keyof typeof NOTIF_TYPE_CONFIG }) {
  const cfg = NOTIF_TYPE_CONFIG[type];
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ backgroundColor: `${cfg.color}1f`, color: cfg.color }}
    >
      {cfg.label}
    </span>
  );
}

export function NotificationsPage() {
  const [expandedSummaryId, setExpandedSummaryId] = useState<string | null>(null);
  const {
    isAdmin,
    todayIso,
    dueTasks,
    dueFollowUps,
    teamSummaries,
    pendingShares,
    auctionAlerts,
    toggleTask,
    acceptShare,
    declineShare,
    acknowledgeAuctionAlert,
    readIds,
    unreadCount,
    markRead,
    markAllRead,
  } = useNotificationsContext();

  const empty =
    dueTasks.length === 0 &&
    dueFollowUps.length === 0 &&
    auctionAlerts.length === 0 &&
    (!isAdmin || (teamSummaries.length === 0 && pendingShares.length === 0));

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text">Notifications</h1>
          <p className="text-sm text-text-3">Shared leads, daily summaries, follow-ups, and tasks that need your attention.</p>
        </div>
        {unreadCount > 0 && (
          <button className="btn shrink-0" onClick={markAllRead}>
            Mark all as read
          </button>
        )}
      </div>

      {empty ? (
        <div className="card text-center text-text-3">You're all caught up — nothing due today.</div>
      ) : (
        <div className="space-y-5">
          {isAdmin && pendingShares.length > 0 && (
            <div className="card">
              <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
                <Share2 size={12} /> Shared Leads ({pendingShares.length})
              </div>
              <div className="space-y-1.5">
                {pendingShares.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-2 bg-surface-3 p-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      <div className="min-w-0 text-[13px] text-text">
                        <span className="font-medium">{s.fromName}</span> shared <span className="font-medium">{s.leadName}</span> with
                        you, while in <span className="font-medium">{STAGE_CONFIG[s.stageAtShare].label}</span> stage
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <NotifTag type="share" />
                      <button
                        className="btn btn-primary !px-2.5 !py-1 text-[12px]"
                        disabled={acceptShare.isPending}
                        onClick={() => acceptShare.mutate(s.id)}
                      >
                        <Check size={13} /> Accept
                      </button>
                      <button
                        className="btn !px-2.5 !py-1 text-[12px] text-danger hover:border-danger"
                        disabled={declineShare.isPending}
                        onClick={() => declineShare.mutate(s.id)}
                      >
                        <X size={13} /> Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {auctionAlerts.length > 0 && (
            <div className="card">
              <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
                <Gavel size={12} /> Auction Reminders ({auctionAlerts.length})
              </div>
              <div className="space-y-1.5">
                {auctionAlerts.map((a) => {
                  const id = `auction:${a.lead.id}:${a.milestone}`;
                  const unread = !readIds.has(id);
                  return (
                    <div key={id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-2 bg-surface-3 p-3">
                      <div className="flex min-w-0 items-center gap-2">
                        {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                        <div className="min-w-0 text-[13px] text-text">
                          <span className="font-medium">
                            {a.lead.firstName} {a.lead.lastName}
                          </span>{' '}
                          — {a.daysRemaining} day{a.daysRemaining !== 1 ? 's' : ''} until auction. Time for a follow-up call.
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <NotifTag type="auction" />
                        <button className="btn !px-2.5 !py-1 text-[12px]" onClick={() => acknowledgeAuctionAlert(a.lead.id, a.milestone)}>
                          Got it
                        </button>
                        <Link
                          to={`/leads/${a.lead.id}`}
                          onClick={() => acknowledgeAuctionAlert(a.lead.id, a.milestone)}
                          className="text-[12px] text-primary hover:underline"
                        >
                          View lead
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {isAdmin && teamSummaries.length > 0 && (
            <div className="card">
              <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
                <FileText size={12} /> Daily Summaries ({teamSummaries.length})
              </div>
              <div className="space-y-1.5">
                {teamSummaries.map((s) => {
                  const id = `summary:${s.id}`;
                  const expanded = expandedSummaryId === s.id;
                  const unread = !readIds.has(id);
                  return (
                    <div key={s.id} className="rounded-md border border-border-2 bg-surface-3 p-3">
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
                        <div className="flex shrink-0 items-center gap-2">
                          <NotifTag type="summary" />
                          <ChevronDown size={14} className={`shrink-0 text-text-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                        </div>
                      </button>
                      {expanded && <p className="mt-2 whitespace-pre-wrap text-[13px] text-text-2">{s.summary}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {dueFollowUps.length > 0 && (
            <div className="card">
              <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
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
                      onClick={() => markRead([id])}
                      className="flex items-center justify-between gap-3 rounded-md border border-border-2 bg-surface-3 p-3 hover:border-primary"
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
                      <NotifTag type="followup" />
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {dueTasks.length > 0 && (
            <div className="card">
              <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
                <CheckSquare size={12} /> Tasks Due ({dueTasks.length})
              </div>
              <div className="space-y-1.5">
                {dueTasks.map((t) => {
                  const id = `task:${t.id}`;
                  const unread = !readIds.has(id);
                  return (
                    <div key={t.id} className="flex items-center justify-between gap-3 rounded-md border border-border-2 bg-surface-3 p-3">
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
                      <div className="flex shrink-0 items-center gap-2">
                        <NotifTag type="task" />
                        {t.leadId && (
                          <Link to={`/leads/${t.leadId}`} onClick={() => markRead([id])} className="text-[12px] text-primary hover:underline">
                            View lead
                          </Link>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
