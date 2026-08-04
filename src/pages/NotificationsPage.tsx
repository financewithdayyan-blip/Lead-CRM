import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRightLeft, Bell, Check, CalendarClock, CheckSquare, ChevronDown, FileText,
  Gavel, Globe, MessageSquare, Phone, Share2, X, type LucideIcon,
} from 'lucide-react';
import { useNotificationsContext } from '@/contexts/NotificationsContext';
import { STAGE_CONFIG } from '@/types/domain';
import { formatDate, formatTime, localIsoDate } from '@/lib/utils';

/**
 * The page answers two questions, in this order:
 *   1. What is waiting on me?  -> "Needs your action", ranked by urgency
 *   2. What happened?          -> "Recent activity", newest first, grouped by day
 *
 * Everything is normalised into one FeedItem shape so every row looks and
 * behaves the same regardless of which of the ten sources it came from.
 */

// ── Model ──────────────────────────────────────────────────────────────────

type Category = 'auction' | 'weblead' | 'leadactivity' | 'task' | 'team';

interface FeedItem {
  id: string;
  category: Category;
  /** Sort key. Timestamp for activity, due date for action items. */
  at: string;
  unread: boolean;
  icon: LucideIcon;
  accent: string;
  title: ReactNode;
  detail?: ReactNode;
  /** Right-aligned timestamp or due label. */
  meta?: string;
  /** Whole row becomes a link when set. */
  href?: string;
  onOpen?: () => void;
  actions?: ReactNode;
  /** Action items only: 0 = overdue, 1 = today, 2 = upcoming. */
  rank?: number;
  /** Renders below the row when expanded (daily summaries). */
  expanded?: ReactNode;
}

const ACCENT = {
  auction: '#ef4444',
  weblead: '#10b981',
  note: '#4f46e5',
  transfer: '#c084fc',
  share: '#10b981',
  followup: '#a78bfa',
  task: '#f59e0b',
  session: '#6366f1',
  summary: '#4f46e5',
  done: '#10b981',
} as const;

const FILTERS: { key: Category | 'all'; label: string; adminOnly?: boolean }[] = [
  { key: 'all',          label: 'All' },
  { key: 'weblead',      label: 'Website Leads', adminOnly: true },
  { key: 'auction',      label: 'Auctions' },
  { key: 'leadactivity', label: 'Lead Activity' },
  { key: 'task',         label: 'Tasks & Follow-Ups' },
  { key: 'team',         label: 'Team', adminOnly: true },
];

// ── Formatting ─────────────────────────────────────────────────────────────

function eventTime(at: string, todayIso: string) {
  return localIsoDate(new Date(at)) === todayIso
    ? formatTime(at)
    : new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function dayHeading(at: string, todayIso: string) {
  const day = localIsoDate(new Date(at));
  if (day === todayIso) return 'Today';
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === localIsoDate(yesterday)) return 'Yesterday';
  return new Date(at).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

/** 0 = overdue, 1 = due today, 2 = upcoming — drives both ordering and copy. */
function dueRank(dateIso: string, todayIso: string) {
  return dateIso < todayIso ? 0 : dateIso === todayIso ? 1 : 2;
}

function dueLabel(dateIso: string, todayIso: string) {
  const rank = dueRank(dateIso, todayIso);
  if (rank === 0) return `Overdue · ${formatDate(dateIso)}`;
  if (rank === 1) return 'Due today';
  return `Due ${formatDate(dateIso)}`;
}

// ── Row ────────────────────────────────────────────────────────────────────

function Row({ item, onToggleExpand }: { item: FeedItem; onToggleExpand?: () => void }) {
  const Icon = item.icon;

  const body = (
    <>
      <span
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
        style={{ backgroundColor: `${item.accent}1f`, color: item.accent }}
      >
        <Icon size={14} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {item.unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
          <span className="min-w-0 truncate text-[13px] font-medium text-text">{item.title}</span>
        </span>
        {item.detail && <span className="mt-0.5 block text-[12px] leading-snug text-text-3">{item.detail}</span>}
      </span>

      <span className="flex shrink-0 items-center gap-2">
        {item.meta && <span className="text-[11px] tabular-nums text-text-3">{item.meta}</span>}
        {item.actions}
        {onToggleExpand && (
          <ChevronDown size={14} className={`text-text-3 transition-transform ${item.expanded ? 'rotate-180' : ''}`} />
        )}
      </span>
    </>
  );

  const shell = `flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors ${
    item.unread ? 'bg-primary/[0.04]' : ''
  } hover:bg-surface-3`;

  return (
    <div className="border-b border-border last:border-b-0">
      {item.href ? (
        <Link to={item.href} onClick={item.onOpen} className={shell}>
          {body}
        </Link>
      ) : onToggleExpand || item.onOpen ? (
        <button type="button" onClick={onToggleExpand ?? item.onOpen} className={shell}>
          {body}
        </button>
      ) : (
        <div className={shell}>{body}</div>
      )}
      {item.expanded && <div className="border-t border-border bg-surface-3 px-3 py-3">{item.expanded}</div>}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-3">
        {title}
        <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] tabular-nums">{count}</span>
      </h2>
      <div className="card overflow-hidden !p-0">{children}</div>
    </section>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export function NotificationsPage() {
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const {
    isAdmin, todayIso,
    dueTasks, dueFollowUps, teamSummaries, pendingShares, pendingIncomingShares,
    auctionAlerts, sessionEvents, adminNotes, dbAlerts, webLeads,
    markWebLeadRead, toggleTask, acceptShare, declineShare,
    acceptAdminShare, declineAdminShare, acknowledgeAuctionAlert, markDbAlertRead,
    readIds, unreadCount, markRead, markAllRead,
  } = useNotificationsContext();

  // Read items older than two days drop off so the feed stays about the present.
  const cutoff = new Date(Date.now() - 2 * 864e5).toISOString();
  const recentDbAlerts   = dbAlerts.filter((n) => !n.isRead || n.createdAt >= cutoff);
  const recentSessions   = sessionEvents.filter((e) => !readIds.has(e.id) || e.at >= cutoff);
  const recentSummaries  = teamSummaries.filter((s) => !readIds.has(`summary:${s.id}`) || s.createdAt >= cutoff);
  const recentNotes      = adminNotes.filter((n) => !readIds.has(`adminnote:${n.id}`) || n.createdAt >= cutoff);
  const recentWebLeads   = webLeads.filter((l) => !l.isRead || l.createdAt >= cutoff);

  const btnSm = 'btn !px-2 !py-0.5 text-[11px]';

  // ── Needs your action ────────────────────────────────────────────────────
  // Decisions that block somebody else rank above your own due work.

  const actions: FeedItem[] = [];

  for (const s of isAdmin ? [] : pendingIncomingShares) {
    actions.push({
      id: `transfer:${s.id}`, category: 'leadactivity', at: s.createdAt, unread: true,
      icon: ArrowRightLeft, accent: ACCENT.transfer, rank: -1,
      title: <>Transfer: <span className="font-semibold">{s.leadName}</span></>,
      detail: <>From {s.fromName} · {STAGE_CONFIG[s.stageAtShare].label}</>,
      actions: (
        <>
          <button className={`${btnSm} btn-primary`} disabled={acceptAdminShare.isPending} onClick={() => acceptAdminShare.mutate(s.id)}>
            <Check size={12} /> Accept
          </button>
          <button className={`${btnSm} text-danger hover:border-danger`} disabled={declineAdminShare.isPending} onClick={() => declineAdminShare.mutate(s.id)}>
            <X size={12} /> Decline
          </button>
        </>
      ),
    });
  }

  for (const s of isAdmin ? pendingShares : []) {
    actions.push({
      id: `share:${s.id}`, category: 'leadactivity', at: s.createdAt, unread: true,
      icon: Share2, accent: ACCENT.share, rank: -1,
      title: <><span className="font-semibold">{s.leadName}</span> shared by {s.fromName}</>,
      detail: <>In {STAGE_CONFIG[s.stageAtShare].label} stage</>,
      actions: (
        <>
          <button className={`${btnSm} btn-primary`} disabled={acceptShare.isPending} onClick={() => acceptShare.mutate(s.id)}>
            <Check size={12} /> Accept
          </button>
          <button className={`${btnSm} text-danger hover:border-danger`} disabled={declineShare.isPending} onClick={() => declineShare.mutate(s.id)}>
            <X size={12} /> Decline
          </button>
        </>
      ),
    });
  }

  for (const a of auctionAlerts) {
    const id = `auction:${a.lead.id}:${a.milestone}`;
    actions.push({
      id, category: 'auction', at: a.lead.auctionDate ?? todayIso, unread: !readIds.has(id),
      icon: Gavel, accent: ACCENT.auction, rank: 0,
      title: <>{a.lead.firstName} {a.lead.lastName}</>,
      detail: <>{a.daysRemaining} day{a.daysRemaining !== 1 ? 's' : ''} until auction · {STAGE_CONFIG[a.lead.stage].label}</>,
      actions: (
        <>
          <button className={btnSm} onClick={() => acknowledgeAuctionAlert(a.lead.id, a.milestone)}>Got it</button>
          <Link to={`/leads/${a.lead.id}`} onClick={() => acknowledgeAuctionAlert(a.lead.id, a.milestone)} className="text-[11px] text-primary hover:underline">
            View
          </Link>
        </>
      ),
    });
  }

  for (const t of dueTasks) {
    const id = `task:${t.id}:${t.dueDate}`;
    actions.push({
      id, category: 'task', at: t.dueDate!, unread: !readIds.has(id),
      icon: CheckSquare, accent: ACCENT.task, rank: dueRank(t.dueDate!, todayIso),
      title: t.title,
      detail: dueLabel(t.dueDate!, todayIso),
      actions: (
        <>
          <input
            type="checkbox"
            checked={t.completed}
            className="h-3.5 w-3.5 cursor-pointer accent-primary"
            title="Mark complete"
            onChange={(e) => { toggleTask.mutate({ id: t.id, completed: e.target.checked }); markRead([id]); }}
          />
          {t.leadId && (
            <Link to={`/leads/${t.leadId}`} onClick={() => markRead([id])} className="text-[11px] text-primary hover:underline">
              View
            </Link>
          )}
        </>
      ),
    });
  }

  for (const l of dueFollowUps) {
    const id = `followup:${l.id}:${l.nextFollowUp}`;
    actions.push({
      id, category: 'task', at: l.nextFollowUp!, unread: !readIds.has(id),
      icon: CalendarClock, accent: ACCENT.followup, rank: dueRank(l.nextFollowUp!, todayIso),
      title: <>{l.firstName} {l.lastName}</>,
      detail: dueLabel(l.nextFollowUp!, todayIso),
      href: `/leads/${l.id}`, onOpen: () => markRead([id]),
    });
  }

  actions.sort((a, b) => (a.rank ?? 9) - (b.rank ?? 9) || a.at.localeCompare(b.at));

  // ── Recent activity ──────────────────────────────────────────────────────

  const activity: FeedItem[] = [];

  for (const l of recentWebLeads) {
    activity.push({
      id: `weblead:${l.id}`, category: 'weblead', at: l.createdAt, unread: !l.isRead,
      icon: Globe, accent: ACCENT.weblead,
      title: <>Website inquiry from {l.firstName} {l.lastName}</>,
      detail: (
        <>
          {l.phone}{l.email ? ` · ${l.email}` : ''}
          {l.propertyAddress ? <><br />{l.propertyAddress}</> : null}
          {l.situation || l.timeline ? <><br />{[l.situation, l.timeline].filter(Boolean).join(' · ')}</> : null}
          {l.notes ? <><br /><span className="italic">"{l.notes}"</span></> : null}
        </>
      ),
      meta: eventTime(l.createdAt, todayIso),
      onOpen: !l.isRead ? () => markWebLeadRead(l.id) : undefined,
    });
  }

  for (const n of recentDbAlerts) {
    activity.push({
      id: `dbalert:${n.id}`, category: 'auction', at: n.createdAt, unread: !n.isRead,
      icon: Bell, accent: n.type === 'auction_passed' ? '#6b7280' : ACCENT.auction,
      title: n.title,
      detail: n.body ?? undefined,
      meta: eventTime(n.createdAt, todayIso),
      onOpen: !n.isRead ? () => markDbAlertRead([n.id]) : undefined,
    });
  }

  for (const n of recentNotes) {
    const id = `adminnote:${n.id}`;
    activity.push({
      id, category: 'leadactivity', at: n.createdAt, unread: !readIds.has(id),
      icon: MessageSquare, accent: ACCENT.note,
      title: <>{n.authorName} noted on {n.leadName}</>,
      detail: n.body ? <span className="italic">"{n.body}"</span> : undefined,
      meta: eventTime(n.createdAt, todayIso),
      href: `/leads/${n.leadId}`, onOpen: () => markRead([id]),
    });
  }

  for (const e of recentSessions) {
    activity.push({
      id: e.id, category: 'team', at: e.at, unread: !readIds.has(e.id),
      icon: Phone, accent: e.type === 'start' ? ACCENT.session : ACCENT.done,
      title: e.type === 'start'
        ? <>{e.memberName} started a calling session</>
        : <>{e.memberName} finished their calling session</>,
      meta: eventTime(e.at, todayIso),
      onOpen: () => markRead([e.id]),
    });
  }

  for (const s of recentSummaries) {
    const id = `summary:${s.id}`;
    activity.push({
      id, category: 'team', at: s.createdAt, unread: !readIds.has(id),
      icon: FileText, accent: ACCENT.summary,
      title: <>{s.memberName} submitted a daily summary</>,
      meta: eventTime(s.createdAt, todayIso),
      expanded: expandedId === id
        ? <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-text-2">{s.summary}</p>
        : undefined,
    });
  }

  activity.sort((a, b) => b.at.localeCompare(a.at));

  // ── Filtering ────────────────────────────────────────────────────────────

  const visible = (i: FeedItem) => filter === 'all' || i.category === filter;
  const shownActions = actions.filter(visible);
  const shownActivity = activity.filter(visible);

  const countFor = (key: Category | 'all') =>
    key === 'all'
      ? actions.length + activity.length
      : actions.filter((i) => i.category === key).length + activity.filter((i) => i.category === key).length;

  // Day buckets for the activity feed, preserving newest-first order.
  const days: { label: string; items: FeedItem[] }[] = [];
  for (const item of shownActivity) {
    const label = dayHeading(item.at, todayIso);
    const bucket = days[days.length - 1];
    if (bucket && bucket.label === label) bucket.items.push(item);
    else days.push({ label, items: [item] });
  }

  const nothingAtAll = actions.length + activity.length === 0;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text">Notifications</h1>
          <p className="text-sm text-text-3">
            {unreadCount > 0 ? `${unreadCount} unread · ` : ''}Read items clear after two days.
          </p>
        </div>
        {unreadCount > 0 && (
          <button className="btn shrink-0" onClick={markAllRead}>Mark all as read</button>
        )}
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {FILTERS.map(({ key, label, adminOnly }) => {
          if (adminOnly && !isAdmin) return null;
          const count = countFor(key);
          if (key !== 'all' && count === 0) return null;
          const active = filter === key;
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
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${active ? 'bg-primary text-white' : 'bg-border-2'}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {nothingAtAll ? (
        <div className="card text-center text-text-3">You're all caught up — nothing to show.</div>
      ) : shownActions.length + shownActivity.length === 0 ? (
        <div className="card text-center text-text-3">Nothing in this category.</div>
      ) : (
        <div className="space-y-6">
          {shownActions.length > 0 && (
            <Section title="Needs your action" count={shownActions.length}>
              {shownActions.map((item) => <Row key={item.id} item={item} />)}
            </Section>
          )}

          {days.map((day) => (
            <Section key={day.label} title={day.label} count={day.items.length}>
              {day.items.map((item) => (
                <Row
                  key={item.id}
                  item={item}
                  onToggleExpand={
                    item.id.startsWith('summary:')
                      ? () => {
                          setExpandedId(expandedId === item.id ? null : item.id);
                          markRead([item.id]);
                        }
                      : undefined
                  }
                />
              ))}
            </Section>
          ))}
        </div>
      )}
    </div>
  );
}
