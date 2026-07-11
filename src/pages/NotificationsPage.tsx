import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightLeft, Bell, Check, CalendarClock, CheckSquare, ChevronDown, FileText, Gavel, Globe, MessageSquare, Phone, Share2, X } from 'lucide-react';
import { useNotificationsContext } from '@/contexts/NotificationsContext';
import { STAGE_CONFIG } from '@/types/domain';
import { formatDate, formatTime, localIsoDate } from '@/lib/utils';

// ── Filter chip config ─────────────────────────────────────────────────────

type FilterKey = 'all' | 'session' | 'summary' | 'followup' | 'task' | 'share' | 'transfer' | 'auction' | 'adminnote' | 'dbalerts' | 'weblead';

const FILTER_CONFIG: { key: FilterKey; label: string }[] = [
  { key: 'all',       label: 'All' },
  { key: 'weblead',   label: 'Website Leads' },
  { key: 'dbalerts',  label: 'Auction Alerts' },
  { key: 'adminnote', label: 'Admin Notes' },
  { key: 'transfer',  label: 'Transfer Requests' },
  { key: 'session',   label: 'Calling Sessions' },
  { key: 'summary',   label: 'Daily Summaries' },
  { key: 'followup',  label: 'Follow-Ups' },
  { key: 'task',      label: 'Tasks' },
  { key: 'share',     label: 'Shared Leads' },
  { key: 'auction',   label: 'Milestones' },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function NotifTag({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ backgroundColor: `${color}22`, color }}
    >
      {label}
    </span>
  );
}

function UnreadDot() {
  return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />;
}

function formatEventTime(at: string, todayIso: string): string {
  const dateIso = localIsoDate(new Date(at));
  if (dateIso === todayIso) return formatTime(at);
  const d = new Date(at);
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${formatTime(at)}`;
}

function followUpLabel(nextFollowUp: string, todayIso: string): string {
  if (nextFollowUp < todayIso) return `${formatDate(nextFollowUp)} · Overdue`;
  if (nextFollowUp === todayIso) return `${formatDate(nextFollowUp)} · Today`;
  return `${formatDate(nextFollowUp)} · Upcoming`;
}

function ScrollList({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-h-80 overflow-y-auto space-y-1.5 pr-0.5">
      {children}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export function NotificationsPage() {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [expandedSummaryId, setExpandedSummaryId] = useState<string | null>(null);

  const {
    isAdmin,
    todayIso,
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
  } = useNotificationsContext();

  const dbUnread = dbAlerts.filter((n) => !n.isRead).length;
  const webLeadsUnread = webLeads.filter((l) => !l.isRead).length;
  const counts: Record<FilterKey, number> = {
    all:       dueTasks.length + dueFollowUps.length + auctionAlerts.length + dbAlerts.length +
               (isAdmin
                 ? teamSummaries.length + pendingShares.length + sessionEvents.length + webLeads.length
                 : adminNotes.length + pendingIncomingShares.length),
    weblead:   webLeads.length,
    dbalerts:  dbAlerts.length,
    adminnote: adminNotes.length,
    transfer:  pendingIncomingShares.length,
    session:   sessionEvents.length,
    summary:   teamSummaries.length,
    followup:  dueFollowUps.length,
    task:      dueTasks.length,
    share:     pendingShares.length,
    auction:   auctionAlerts.length,
  };

  const show = (key: FilterKey) => filter === 'all' || filter === key;

  const empty = counts.all === 0;

  return (
    <div>
      {/* Header */}
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text">Notifications</h1>
          <p className="text-sm text-text-3">Shared leads, daily summaries, follow-ups, tasks, and session activity — last 7 days.</p>
        </div>
        {unreadCount > 0 && (
          <button className="btn shrink-0" onClick={markAllRead}>
            Mark all as read
          </button>
        )}
      </div>

      {/* Filter chips */}
      <div className="mb-5 flex flex-wrap gap-2">
        {FILTER_CONFIG.map(({ key, label }) => {
          const active = filter === key;
          const count = counts[key];
          if (key !== 'all' && !isAdmin && (key === 'session' || key === 'summary' || key === 'share' || key === 'weblead')) return null;
          if (key === 'adminnote' && isAdmin) return null;
          if (key === 'transfer' && isAdmin) return null;
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
                active
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border-2 bg-surface-2 text-text-3 hover:border-primary/50 hover:text-text'
              }`}
            >
              {label}
              {count > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${active ? 'bg-primary text-white' : 'bg-border-2 text-text-3'}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {empty ? (
        <div className="card text-center text-text-3">You're all caught up — nothing this week.</div>
      ) : (
        <div className="space-y-5">

          {/* Admin Notes (shown to callers when an admin leaves a note on their lead) */}
          {!isAdmin && show('adminnote') && adminNotes.length > 0 && (
            <div className="card">
              <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
                <MessageSquare size={12} /> Admin Notes ({adminNotes.length})
              </div>
              <ScrollList>
                {adminNotes.map((n) => {
                  const id = `adminnote:${n.id}`;
                  const unread = !readIds.has(id);
                  return (
                    <Link
                      key={n.id}
                      to={`/leads/${n.leadId}`}
                      onClick={() => markRead([id])}
                      className="flex items-center justify-between gap-3 rounded-md border border-border-2 bg-surface-3 p-3 hover:border-primary"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {unread && <UnreadDot />}
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-medium text-text">
                            {n.authorName} left a note on{' '}
                            <span className="font-semibold">{n.leadName}</span>
                          </div>
                          {n.body && (
                            <div className="mt-0.5 truncate text-[12px] italic text-text-3">
                              "{n.body}"
                            </div>
                          )}
                          <div className="text-[11px] text-text-3">{formatEventTime(n.createdAt, todayIso)}</div>
                        </div>
                      </div>
                      <NotifTag label="Admin Note" color="#4f46e5" />
                    </Link>
                  );
                })}
              </ScrollList>
            </div>
          )}

          {/* Transfer Requests (shown to callers when admin reassigns a followup lead to them) */}
          {!isAdmin && show('transfer') && pendingIncomingShares.length > 0 && (
            <div className="card">
              <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
                <ArrowRightLeft size={12} /> Transfer Requests ({pendingIncomingShares.length})
              </div>
              <ScrollList>
                {pendingIncomingShares.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-2 bg-surface-3 p-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      <div className="min-w-0 text-[13px] text-text">
                        <span className="font-semibold">{s.leadName}</span>
                        <div className="mt-0.5 text-[12px] text-text-3">
                          Moved from <span className="font-medium text-text">{s.fromName}</span>{' '}
                          to <span className="font-medium text-text">{s.toName}</span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-text-3">
                          Stage: {STAGE_CONFIG[s.stageAtShare].label}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        style={{ backgroundColor: '#c084fc22', color: '#c084fc' }}
                      >
                        Transfer
                      </span>
                      <button
                        className="btn btn-primary !px-2.5 !py-1 text-[12px]"
                        disabled={acceptAdminShare.isPending}
                        onClick={() => acceptAdminShare.mutate(s.id)}
                      >
                        <Check size={13} /> Accept
                      </button>
                      <button
                        className="btn !px-2.5 !py-1 text-[12px] text-danger hover:border-danger"
                        disabled={declineAdminShare.isPending}
                        onClick={() => declineAdminShare.mutate(s.id)}
                      >
                        <X size={13} /> Decline
                      </button>
                    </div>
                  </div>
                ))}
              </ScrollList>
            </div>
          )}

          {/* Website Inquiries */}
          {isAdmin && show('weblead') && webLeads.length > 0 && (
            <div className="card">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
                  <Globe size={12} /> Website Inquiries ({webLeads.length})
                </div>
                {webLeadsUnread > 0 && (
                  <button
                    className="text-[11px] text-primary hover:underline"
                    onClick={markAllWebLeadsRead}
                  >
                    Mark all read
                  </button>
                )}
              </div>
              <ScrollList>
                {webLeads.map((l) => (
                  <div
                    key={l.id}
                    className={`rounded-md border p-3 transition-colors ${
                      l.isRead ? 'border-border-2 bg-surface-3' : 'border-primary/30 bg-primary/5'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {!l.isRead && <UnreadDot />}
                          <span className="text-[13px] font-semibold text-text">
                            {l.firstName} {l.lastName}
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-text-2">
                          <a href={`tel:${l.phone}`} className="hover:text-primary">{l.phone}</a>
                          {l.email && (
                            <a href={`mailto:${l.email}`} className="truncate hover:text-primary">{l.email}</a>
                          )}
                        </div>
                        <div className="mt-1 text-[12px] text-text-3">{l.propertyAddress}</div>
                        {(l.situation || l.timeline) && (
                          <div className="mt-0.5 text-[12px] text-text-3">
                            {[l.situation, l.timeline].filter(Boolean).join(' · ')}
                          </div>
                        )}
                        {l.notes && (
                          <div className="mt-1 text-[12px] italic text-text-3">"{l.notes}"</div>
                        )}
                        <div className="mt-1 text-[11px] text-text-3">{formatEventTime(l.createdAt, todayIso)}</div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <NotifTag label="Website Lead" color="#10b981" />
                        {!l.isRead && (
                          <button
                            className="text-[11px] text-primary hover:underline"
                            onClick={() => markWebLeadRead(l.id)}
                          >
                            Mark read
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </ScrollList>
            </div>
          )}

          {/* Shared Leads */}
          {isAdmin && show('share') && pendingShares.length > 0 && (
            <div className="card">
              <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
                <Share2 size={12} /> Shared Leads ({pendingShares.length})
              </div>
              <ScrollList>
                {pendingShares.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-2 bg-surface-3 p-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      <div className="min-w-0 text-[13px] text-text">
                        <span className="font-medium">{s.fromName}</span> shared{' '}
                        <span className="font-medium">{s.leadName}</span> with you, while in{' '}
                        <span className="font-medium">{STAGE_CONFIG[s.stageAtShare].label}</span> stage
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <NotifTag label="Shared Lead" color="#10b981" />
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
              </ScrollList>
            </div>
          )}

          {/* Scheduled Auction Alerts (generated server-side by pg_cron) */}
          {show('dbalerts') && dbAlerts.length > 0 && (
            <div className="card">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
                  <Bell size={12} /> Auction Alerts ({dbAlerts.length})
                </div>
                {dbUnread > 0 && (
                  <button
                    className="text-[11px] text-primary hover:underline"
                    onClick={() => markDbAlertRead(dbAlerts.filter((n) => !n.isRead).map((n) => n.id))}
                  >
                    Mark all read
                  </button>
                )}
              </div>
              <ScrollList>
                {dbAlerts.map((n) => {
                  const tierMatch = n.title.match(/—\s*(\w+)$/);
                  const tierColor =
                    n.type === 'auction_passed' ? '#6b7280'
                    : tierMatch?.[1] === 'CRITICAL' ? '#ef4444'
                    : tierMatch?.[1] === 'URGENT'   ? '#f97316'
                    : tierMatch?.[1] === 'HIGH'     ? '#eab308'
                    : tierMatch?.[1] === 'MEDIUM'   ? '#60a5fa'
                    : '#9ca3af';
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => !n.isRead && markDbAlertRead([n.id])}
                      className={`flex w-full items-start justify-between gap-3 rounded-md border p-3 text-left transition-colors ${
                        n.isRead ? 'border-border-2 bg-surface-3' : 'border-primary/30 bg-primary/5 hover:border-primary/50'
                      }`}
                    >
                      <div className="flex min-w-0 items-start gap-2">
                        {!n.isRead && <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-text">{n.title}</div>
                          {n.body && <div className="mt-0.5 text-[12px] text-text-3">{n.body}</div>}
                          <div className="mt-0.5 text-[11px] text-text-3">
                            {new Date(n.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                      <span
                        className="mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        style={{ backgroundColor: `${tierColor}22`, color: tierColor }}
                      >
                        {n.type === 'auction_passed' ? 'Passed'
                          : n.type === 'auction_tier_change' ? 'Tier Change'
                          : 'Reminder'}
                      </span>
                    </button>
                  );
                })}
              </ScrollList>
            </div>
          )}

          {/* Auction milestone reminders (client-side) */}
          {show('auction') && auctionAlerts.length > 0 && (
            <div className="card">
              <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
                <Gavel size={12} /> Auction Reminders ({auctionAlerts.length})
              </div>
              <ScrollList>
                {auctionAlerts.map((a) => {
                  const id = `auction:${a.lead.id}:${a.milestone}`;
                  const unread = !readIds.has(id);
                  return (
                    <div key={id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-2 bg-surface-3 p-3">
                      <div className="flex min-w-0 items-center gap-2">
                        {unread && <UnreadDot />}
                        <div className="min-w-0 text-[13px] text-text">
                          <span className="font-medium">{a.lead.firstName} {a.lead.lastName}</span>
                          {' '}— {a.daysRemaining} day{a.daysRemaining !== 1 ? 's' : ''} until auction.
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <NotifTag label="Auction" color="#ef4444" />
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
              </ScrollList>
            </div>
          )}

          {/* Calling Sessions */}
          {isAdmin && show('session') && sessionEvents.length > 0 && (
            <div className="card">
              <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
                <Phone size={12} /> Calling Sessions ({sessionEvents.length})
              </div>
              <ScrollList>
                {sessionEvents.map((e) => {
                  const unread = !readIds.has(e.id);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => markRead([e.id])}
                      className="flex w-full items-center justify-between gap-3 rounded-md border border-border-2 bg-surface-3 p-3 text-left hover:border-primary"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {unread && <UnreadDot />}
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-medium text-text">
                            {e.memberName} started a calling session
                          </div>
                          <div className="text-[11px] text-text-3">{formatEventTime(e.at, todayIso)}</div>
                        </div>
                      </div>
                      <NotifTag label="Session" color="#6366f1" />
                    </button>
                  );
                })}
              </ScrollList>
            </div>
          )}

          {/* Daily Summaries */}
          {isAdmin && show('summary') && teamSummaries.length > 0 && (
            <div className="card">
              <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
                <FileText size={12} /> Daily Summaries ({teamSummaries.length})
              </div>
              <ScrollList>
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
                          {unread && <UnreadDot />}
                          <span>
                            <span className="font-medium">{s.memberName}</span> submitted their daily summary
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <NotifTag label="Summary" color="#4f46e5" />
                          <ChevronDown size={14} className={`shrink-0 text-text-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                        </div>
                      </button>
                      {expanded && (
                        <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-text-2">{s.summary}</p>
                      )}
                    </div>
                  );
                })}
              </ScrollList>
            </div>
          )}

          {/* Follow-Ups */}
          {show('followup') && dueFollowUps.length > 0 && (
            <div className="card">
              <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
                <CalendarClock size={12} /> Follow-Ups ({dueFollowUps.length})
              </div>
              <ScrollList>
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
                        {unread && <UnreadDot />}
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-medium text-text">
                            {l.firstName} {l.lastName}
                          </div>
                          <div className="text-[11px] text-text-3">{followUpLabel(l.nextFollowUp!, todayIso)}</div>
                        </div>
                      </div>
                      <NotifTag label="Follow-Up" color="#a78bfa" />
                    </Link>
                  );
                })}
              </ScrollList>
            </div>
          )}

          {/* Tasks */}
          {show('task') && dueTasks.length > 0 && (
            <div className="card">
              <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
                <CheckSquare size={12} /> Tasks ({dueTasks.length})
              </div>
              <ScrollList>
                {dueTasks.map((t) => {
                  const id = `task:${t.id}`;
                  const unread = !readIds.has(id);
                  return (
                    <div key={t.id} className="flex items-center justify-between gap-3 rounded-md border border-border-2 bg-surface-3 p-3">
                      <label className="flex min-w-0 cursor-pointer items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={t.completed}
                          onChange={(e) => {
                            toggleTask.mutate({ id: t.id, completed: e.target.checked });
                            markRead([id]);
                          }}
                        />
                        {unread && <UnreadDot />}
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-medium text-text">{t.title}</div>
                          <div className="text-[11px] text-text-3">{followUpLabel(t.dueDate!, todayIso)}</div>
                        </div>
                      </label>
                      <div className="flex shrink-0 items-center gap-2">
                        <NotifTag label="Task" color="#f59e0b" />
                        {t.leadId && (
                          <Link to={`/leads/${t.leadId}`} onClick={() => markRead([id])} className="text-[12px] text-primary hover:underline">
                            View lead
                          </Link>
                        )}
                      </div>
                    </div>
                  );
                })}
              </ScrollList>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
