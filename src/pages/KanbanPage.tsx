import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { Phone, Pencil, Share2, Trash2, Copy, Check, Download, Users, CalendarClock, MessageSquare, BellRing, Loader2, MapPin, Sparkles, X as XIcon } from 'lucide-react';
import { useLeads, useDeleteLeads, useUpdateLead } from '@/hooks/useLeads';
import { useTags } from '@/hooks/useTags';
import { useReceivedLeadShares, useAdminShareLeadToCaller, useTransferLeadToAdmin } from '@/hooks/useLeadShares';
import { useSendReminders } from '@/hooks/useSms';
import { useAddActivity } from '@/hooks/useActivities';
import { useTeamMembers } from '@/hooks/useTeam';
import { useAuth } from '@/contexts/AuthContext';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { VirtualCardList } from '@/components/kanban/VirtualCardList';
import { BulkSmsModal } from '@/components/sms/BulkSmsModal';
import { useThreadMessageCounts } from '@/hooks/useLeadMessages';
import { TagPill } from '@/components/ui/TagPill';
import { AuctionCountdown } from '@/components/ui/AuctionCountdown';
import { formatDate, formatPhone, localIsoDate, toE164 } from '@/lib/utils';
import { STAGE_ORDER, STAGE_CONFIG, visibleStagesFor, type Lead, type LeadStage, type Tag } from '@/types/domain';

const CLEARABLE_STAGES: LeadStage[] = ['new', 'voicemail', 'dead_declined'];
const DELETABLE_STAGES: LeadStage[] = ['new', 'voicemail', 'dead_declined'];
// Stages that are no longer active work — visually receded (muted column,
// faded cards) rather than removed, so a full pipeline doesn't bury the
// stages that still need attention.
const DIMMED_STAGES: LeadStage[] = ['dead_declined', 'onhold', 'others'];
// Cold Lead / Contacted are pre-outreach stages — nothing to call or text
// about yet, so the Call/Text row is hidden on cards in these columns.
const NO_CONTACT_STAGES: LeadStage[] = ['new', 'contacted'];
interface CardTheme {
  gradient: string;
  text: string;
  sub: string;
  sub3: string;
  divider: string;
  callBtn: string;
  textBtn: string;
  iconBtn: string;
  // Small info pills (message count, "shared by") — their default
  // `bg-info/15` is a near-transparent tint meant to sit on a white card;
  // on a colored gradient it turns into an unreadable smudge, so themed
  // cards get an opaque pill instead.
  badge: string;
  // The backdrop a tag pill sits on. Tags carry their own arbitrary
  // pastel bg/text colors (per-tag, user-chosen) tuned to read on a white
  // card — on a colored gradient a similarly-toned tag can nearly
  // disappear (e.g. green-on-green), so themed cards give every tag a
  // small white halo to guarantee contrast regardless of the tag's own
  // color or the card's.
  tagBackdrop: string;
}

// Gold-on-dark is the one recurring signature — the same "this button
// matters" accent used for the Call button on every full-color card below
// except Closed, where the card itself is already gold and needs the
// inverse (navy button) to read against it.
const GOLD_CALL_BTN = 'bg-accent text-text hover:bg-accent-hover';
const WHITE_TEXT_BTN = 'bg-white/10 text-white hover:bg-white/20';
const WHITE_ICON_BTN = 'text-white/70 hover:bg-white/10 hover:text-white';
const WHITE_BADGE = 'bg-white/25 text-white';
const WHITE_TAG_BACKDROP = 'inline-flex rounded-full bg-white/90 p-0.5';

const NAVY_THEME: CardTheme = {
  gradient: 'from-sidebar to-sidebar-2',
  text: 'text-white',
  sub: 'text-white/70',
  sub3: 'text-white/50',
  divider: 'border-white/10',
  callBtn: GOLD_CALL_BTN,
  textBtn: WHITE_TEXT_BTN,
  iconBtn: WHITE_ICON_BTN,
  badge: WHITE_BADGE,
  tagBackdrop: WHITE_TAG_BACKDROP,
};

// Every fully-colored card below shares the same shape — a gradient built
// from that stage's own STAGE_CONFIG color, not an arbitrary new palette —
// so the board reads as "here's what's happening with this lead" at a
// glance instead of every stage past Qualified looking the same pale gray.
const CARD_THEME: Partial<Record<LeadStage, CardTheme>> = {
  // Cold Lead — the brand's own sky-blue primary, same pair used for
  // Call/primary buttons everywhere else in the app.
  new: {
    gradient: 'from-primary to-primary-hover',
    text: 'text-white',
    sub: 'text-white/70',
    sub3: 'text-white/50',
    divider: 'border-white/10',
    callBtn: GOLD_CALL_BTN,
    textBtn: WHITE_TEXT_BTN,
    iconBtn: WHITE_ICON_BTN,
    badge: WHITE_BADGE,
    tagBackdrop: WHITE_TAG_BACKDROP,
  },
  // Qualified — every card, not just the best-scored one (see `themed` below).
  followup: NAVY_THEME,
  // Contract — a deal actively in motion.
  contract: {
    gradient: 'from-[#059669] to-[#065f46]',
    text: 'text-white',
    sub: 'text-white/70',
    sub3: 'text-white/50',
    divider: 'border-white/10',
    callBtn: GOLD_CALL_BTN,
    textBtn: WHITE_TEXT_BTN,
    iconBtn: WHITE_ICON_BTN,
    badge: WHITE_BADGE,
    tagBackdrop: WHITE_TAG_BACKDROP,
  },
  // Closed — the brass "closing-table" accent, sparingly used everywhere
  // else in the app, gets its one moment to be the whole card. Gold-on-gold
  // has no contrast, so the Call button flips to navy here instead of gold.
  closed: {
    gradient: 'from-accent to-accent-hover',
    text: 'text-text',
    sub: 'text-text/75',
    sub3: 'text-text/55',
    divider: 'border-text/15',
    callBtn: 'bg-sidebar text-white hover:bg-sidebar-2',
    textBtn: 'bg-text/10 text-text hover:bg-text/15',
    iconBtn: 'text-text/60 hover:bg-text/10 hover:text-text',
    badge: 'bg-text/15 text-text',
    tagBackdrop: 'inline-flex rounded-full bg-white/70 p-0.5',
  },
  // Dead/Declined — still visually recedes (see DIMMED_STAGES' opacity-70
  // below), but the card itself is a real, deliberate red rather than a
  // washed-out pink tint.
  dead_declined: {
    gradient: 'from-[#dc2626] to-[#991b1b]',
    text: 'text-white',
    sub: 'text-white/70',
    sub3: 'text-white/50',
    divider: 'border-white/10',
    callBtn: GOLD_CALL_BTN,
    textBtn: WHITE_TEXT_BTN,
    iconBtn: WHITE_ICON_BTN,
    badge: WHITE_BADGE,
    tagBackdrop: WHITE_TAG_BACKDROP,
  },
};
// The one dark "spotlight" card per column — the strongest lead in that
// stage, using the AI Lead Score already computed on the Lead Profile
// rather than a made-up rule. Gated at "Good" (65+) so a column with no
// scored leads, or only weak ones, simply has no spotlight card — same as
// the mockup, where not every column has one. Stages already in CARD_THEME
// are excluded (see spotlightIds below) since every card there already
// gets a themed look regardless of score.
const SPOTLIGHT_MIN_SCORE = 65;

/** Lowercases and reduces every run of punctuation to a single space, so commas,
 *  periods, hashes and hyphens can't block a match on either side. */
function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Digits only, with a US country code dropped, so "+1 (813) 555-0134",
 *  "18135550134" and "813-555-0134" all reduce to the same ten digits. */
function phoneDigits(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

/**
 * Matches a lead against a search box that may hold a name, a phone in any
 * format, or a full address pasted straight out of a text message.
 *
 * Tokenised rather than one substring test: a pasted "123 Main St, Tampa, FL
 * 33601" can never substring-match a record that stores street, city, state and
 * zip as separate columns. Requiring every token to appear somewhere in the
 * lead makes word order and punctuation stop mattering.
 */
function leadMatchesSearch(lead: Lead, tokens: string[], queryDigits: string) {
  // A 7+ digit query is a phone number, not a street number — compare it against
  // the digits of both phone fields so formatting never blocks a hit.
  if (queryDigits.length >= 7) {
    if (phoneDigits(lead.phone).includes(queryDigits)) return true;
    if (lead.phone2 && phoneDigits(lead.phone2).includes(queryDigits)) return true;
  }

  const haystack = normalizeText(
    [
      lead.firstName,
      lead.lastName,
      lead.phone,
      lead.phone2,
      lead.email,
      lead.address,
      lead.city,
      lead.state,
      lead.zip,
    ]
      .filter(Boolean)
      .join(' '),
  );

  return tokens.every((token) => haystack.includes(token));
}

function exportCsv(selectedLeads: Lead[], tags: Tag[]) {
  const tagMap = Object.fromEntries(tags.map((t) => [t.id, t.name]));
  const header = ['Lead#', 'First Name', 'Last Name', 'Phone', 'Phone 2', 'Email', 'Address', 'City', 'State', 'Zip', 'Stage', 'Tags', 'Notes', 'Source', 'Created'];
  const rows = selectedLeads.map((l) => [
    l.leadNum ?? '',
    l.firstName,
    l.lastName,
    l.phone,
    l.phone2 ?? '',
    l.email ?? '',
    l.address ?? '',
    l.city ?? '',
    l.state ?? '',
    l.zip ?? '',
    STAGE_CONFIG[l.stage].label,
    l.tagIds.map((id) => tagMap[id] ?? '').filter(Boolean).join('; '),
    l.notes ?? '',
    l.source ?? '',
    l.createdAt ? new Date(l.createdAt).toLocaleDateString() : '',
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Shared card visual ──────────────────────────────────────────────────────
// Used both in-column (with drag handles) and in the DragOverlay (static copy).

function KanbanCardVisual({
  lead,
  viewOnly,
  tags,
  sharedFrom,
  messageCount = 0,
  selected,
  spotlight = false,
  canSms,
  onToggleSelect,
  onCall,
  onText,
  onOpen,
  onDelete,
  dragProps,
  lifted = false,
}: {
  lead: Lead;
  viewOnly: boolean;
  tags: Tag[];
  sharedFrom?: string;
  messageCount?: number;
  selected: boolean;
  spotlight?: boolean;
  canSms: boolean;
  onToggleSelect: () => void;
  onCall: () => void;
  onText: () => void;
  onOpen: () => void;
  onDelete: () => void;
  dragProps?: React.HTMLAttributes<HTMLDivElement>;
  lifted?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  function copyPhone(e: React.MouseEvent) {
    e.stopPropagation();
    if (!lead.phone) return;
    navigator.clipboard.writeText(lead.phone).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const dimmed = DIMMED_STAGES.includes(lead.stage);
  // A stage in CARD_THEME gets its theme on every card; every other card
  // stays plain regardless of spotlight — recoloring the spotlighted card
  // (tried once, reverted) made it indistinguishable from an actual
  // Qualified-stage card at a glance. The AI score badge below is what
  // marks it now, not the card's own background.
  const theme = CARD_THEME[lead.stage] ?? null;
  const themed = !!theme && !selected && !sharedFrom;

  const sx = themed
    ? theme!
    : {
        sub: 'text-text-2',
        sub3: 'text-text-3',
        divider: 'border-surface-3',
        callBtn: 'border border-primary/30 bg-primary-dim text-primary hover:bg-primary/20',
        textBtn: 'border border-border-2 bg-surface-3 text-text-2 hover:bg-surface-3/70',
        iconBtn: 'text-text-3 hover:bg-surface-3 hover:text-text-2',
        badge: 'bg-info/15 text-info-text',
        tagBackdrop: '',
      };

  return (
    <div
      className={`rounded-md border p-2 text-[11.5px] transition-shadow ${
        selected
          ? 'border-primary bg-primary/5'
          : sharedFrom
            ? 'border-info/30 bg-info-dim'
            : themed
              ? `border-transparent bg-gradient-to-br ${theme!.gradient}`
              : 'border-border-2 bg-surface'
      } ${dimmed && !selected ? 'opacity-70' : ''} ${lifted ? 'rotate-1 shadow-2xl' : 'shadow-card hover:shadow-card-hover'}`}
      style={lifted ? { willChange: 'transform' } : undefined}
      onDoubleClick={onOpen}
    >
      {/* Checkbox row — outside dragProps so clicks don't start a drag */}
      <div className="flex items-start gap-1.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          className="mt-0.5 h-3 w-3 shrink-0 cursor-pointer accent-primary"
        />
        <div {...dragProps} className={`min-w-0 flex-1 ${dragProps ? 'cursor-grab active:cursor-grabbing' : ''}`}>
          <div className="flex flex-wrap items-center justify-between gap-x-1 gap-y-0.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className={`truncate font-medium ${themed ? theme!.text : 'text-text'}`}>
                {lead.firstName} {lead.lastName}
              </span>
              {/* The only marker on the spotlighted card now — no card-color
                  change, just this badge naming the actual score. */}
              {spotlight && lead.aiScore !== null && (
                <span
                  className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${sx.badge}`}
                  title={`AI Lead Score ${lead.aiScore}/100 — the strongest lead in this column`}
                >
                  <Sparkles size={9} /> {lead.aiScore}
                </span>
              )}
            </div>
            <div className={`shrink-0 text-[10px] ${sx.sub3}`}>#{lead.leadNum}</div>
          </div>
          <div className="mt-1 flex items-center justify-between gap-1">
            <div className={`flex min-w-0 items-center gap-1.5 ${sx.sub}`}>
              <span className="font-mono tabular-nums">{formatPhone(lead.phone)}</span>
              {messageCount > 0 && (
                <span
                  className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${sx.badge}`}
                  title={`${messageCount} SMS message${messageCount === 1 ? '' : 's'} (sent + received)`}
                >
                  <MessageSquare size={9} /> {messageCount}
                </span>
              )}
            </div>
            {/* Slim by living on the phone row instead of a row of their
                own — same copy/edit/delete, just no longer a dedicated
                strip under every card. */}
            <div className="flex shrink-0 items-center gap-0.5">
              {lead.phone && (
                <button
                  onClick={copyPhone}
                  className={`rounded p-1 transition-colors ${copied ? 'text-success' : sx.iconBtn}`}
                  title={copied ? 'Copied!' : 'Copy phone'}
                >
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen();
                }}
                className={`rounded p-1 transition-colors ${sx.iconBtn}`}
                title="Edit"
              >
                <Pencil size={11} />
              </button>
              {DELETABLE_STAGES.includes(lead.stage) && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                  className={`rounded p-1 transition-colors ${themed ? sx.iconBtn : 'text-text-3 hover:bg-danger-dim hover:text-danger'}`}
                  title="Delete"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          </div>
          {lead.address && (
            <div className={`mt-0.5 flex items-start gap-1 truncate ${sx.sub3}`} title={lead.address}>
              <MapPin size={10} className="mt-0.5 shrink-0" />
              <span className="truncate">{lead.address}</span>
            </div>
          )}
          {lead.auctionDate && <AuctionCountdown auctionDate={lead.auctionDate} className="mt-0.5" />}
          {/* Deliberately not everything lives on the card — AI score and
              touch-progress are real, useful facts, but they belong on the
              Lead Profile, not crammed onto a small board tile. Tags and a
              due-today nudge are the two things worth a glance from here. */}
          {(lead.tagIds.length > 0 || lead.nextFollowUp || sharedFrom) && (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {lead.tagIds.slice(0, 2).map((tid) => {
                const tag = tags.find((t) => t.id === tid);
                if (!tag) return null;
                // A tag's own pastel colors are tuned for a white card and
                // can wash out on a themed one (e.g. green-on-green) — the
                // backdrop guarantees contrast without touching the tag's
                // actual color.
                return themed ? (
                  <span key={tid} className={sx.tagBackdrop}>
                    <TagPill tag={tag} />
                  </span>
                ) : (
                  <TagPill key={tid} tag={tag} />
                );
              })}
              {lead.nextFollowUp &&
                (() => {
                  const todayStr = localIsoDate(new Date());
                  const overdue = lead.nextFollowUp < todayStr;
                  const isToday = lead.nextFollowUp === todayStr;
                  return (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                        overdue
                          ? 'bg-danger-dim text-danger'
                          : isToday
                            ? 'bg-warning-dim text-warning'
                            : 'bg-surface-3 text-text-3'
                      }`}
                      title={`Next follow-up: ${formatDate(lead.nextFollowUp)}`}
                    >
                      <CalendarClock size={9} />
                      {overdue
                        ? `Overdue · ${formatDate(lead.nextFollowUp)}`
                        : isToday
                          ? 'Follow up today'
                          : formatDate(lead.nextFollowUp)}
                    </span>
                  );
                })()}
              {sharedFrom && (
                <span className="inline-flex items-center gap-1 rounded-full bg-info/15 px-1.5 py-0.5 text-[10px] font-medium text-info-text">
                  <Share2 size={9} /> Shared by {sharedFrom}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      {(!viewOnly || canSms) && lead.phone && !NO_CONTACT_STAGES.includes(lead.stage) && (
        <div className={`mt-1 flex gap-1 border-t pt-1 ${sx.divider}`}>
          {!viewOnly && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCall();
              }}
              className={`flex flex-1 items-center justify-center gap-1 rounded py-1 text-[10.5px] font-semibold transition-colors ${sx.callBtn}`}
            >
              <Phone size={10} /> Call
            </button>
          )}
          {canSms && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onText();
              }}
              className={`flex flex-1 items-center justify-center gap-1 rounded py-1 text-[10.5px] font-semibold transition-colors ${sx.textBtn}`}
            >
              <MessageSquare size={10} /> Text
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Draggable card (in-column) ───────────────────────────────────────────────

const KanbanCard = memo(
  function KanbanCard({
    lead,
    viewOnly,
    tags,
    sharedFrom,
    messageCount,
    selected,
    spotlight,
    canSms,
    onToggleSelect,
    onCall,
    onText,
    onOpen,
    onDelete,
  }: {
    lead: Lead;
    viewOnly: boolean;
    tags: Tag[];
    sharedFrom?: string;
    messageCount?: number;
    selected: boolean;
    spotlight: boolean;
    canSms: boolean;
    onToggleSelect: () => void;
    onCall: () => void;
    onText: () => void;
    onOpen: () => void;
    onDelete: () => void;
  }) {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id });

    return (
      <div ref={setNodeRef}>
        {isDragging ? (
          // Ghost placeholder — keeps the column slot visible while the overlay floats
          <div className="min-h-[60px] rounded-md border border-dashed border-border-2 bg-surface-2 opacity-40" />
        ) : (
          <KanbanCardVisual
            lead={lead}
            viewOnly={viewOnly}
            tags={tags}
            sharedFrom={sharedFrom}
            messageCount={messageCount}
            selected={selected}
            spotlight={spotlight}
            canSms={canSms}
            onToggleSelect={onToggleSelect}
            onCall={onCall}
            onText={onText}
            onOpen={onOpen}
            onDelete={onDelete}
            dragProps={{ ...listeners, ...attributes }}
          />
        )}
      </div>
    );
  },
  // Skip re-renders when only callback refs change — data props are what matter.
  (prev, next) =>
    prev.lead === next.lead &&
    prev.viewOnly === next.viewOnly &&
    prev.tags === next.tags &&
    prev.sharedFrom === next.sharedFrom &&
    prev.messageCount === next.messageCount &&
    prev.selected === next.selected &&
    prev.spotlight === next.spotlight &&
    prev.canSms === next.canSms,
);

// ─── Column ───────────────────────────────────────────────────────────────────

const KanbanColumn = memo(function KanbanColumn({
  stage,
  leads,
  viewOnly,
  tags,
  receivedShares,
  messageCounts,
  selectedIds,
  spotlightIds,
  canSms,
  onToggleSelect,
  onToggleSelectMany,
  onCall,
  onText,
  onOpen,
  onDelete,
  setClearTarget,
}: {
  stage: LeadStage;
  leads: Lead[];
  viewOnly: boolean;
  tags: Tag[];
  receivedShares: Record<string, string>;
  messageCounts: Record<string, number>;
  selectedIds: Set<string>;
  spotlightIds: Set<string>;
  canSms: boolean;
  onToggleSelect: (id: string) => void;
  onToggleSelectMany: (ids: string[], select: boolean) => void;
  onCall: (id: string, phone: string) => void;
  onText: (id: string) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  setClearTarget: (stage: LeadStage | null) => void;
}) {
  const cfg = STAGE_CONFIG[stage];
  const dimmed = DIMMED_STAGES.includes(stage);
  const { setNodeRef, isOver } = useDroppable({ id: stage });

  const ids = useMemo(() => leads.map((l) => l.id), [leads]);
  const selectedHere = ids.reduce((n, id) => (selectedIds.has(id) ? n + 1 : n), 0);
  const allSelected = leads.length > 0 && selectedHere === leads.length;
  const someSelected = selectedHere > 0 && !allSelected;

  // `indeterminate` is a DOM property with no HTML attribute, so it has to be
  // set on the node rather than passed as a prop.
  const headerCheckbox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerCheckbox.current) headerCheckbox.current.indeterminate = someSelected;
  }, [someSelected]);
  return (
    <div
      ref={setNodeRef}
      className={`flex w-64 shrink-0 flex-col rounded-2xl border ${dimmed ? 'bg-surface-3/50' : 'bg-surface-2'} ${isOver ? 'border-primary' : 'border-border'}`}
    >
      {/* Stage color lives on the dot below, not a thick top border — a
          heavy colored border following a large corner radius rendered as
          an odd melted-looking cap rather than a clean strip. */}
      <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
        <input
          ref={headerCheckbox}
          type="checkbox"
          checked={allSelected}
          disabled={leads.length === 0}
          onChange={() => onToggleSelectMany(ids, !allSelected)}
          className="h-3 w-3 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-30"
          title={allSelected ? `Deselect all ${cfg.label}` : `Select all ${cfg.label}`}
        />
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: cfg.color }} />
        <div className="flex-1 truncate text-[12.5px] font-semibold text-text">{cfg.label}</div>
        <div className="shrink-0 rounded-full bg-surface-3 px-1.5 py-0.5 text-[10.5px] text-text-3">{leads.length}</div>
        {CLEARABLE_STAGES.includes(stage) && leads.length > 0 && (
          <button onClick={() => setClearTarget(stage)} className="text-text-3 hover:text-danger" title={`Delete all ${cfg.label}`}>
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {leads.length === 0 ? (
        <div className="flex-1 overflow-y-auto p-1.5" style={{ minHeight: 80, maxHeight: 'calc(100vh - 140px)' }}>
          <div className="py-6 text-center text-[12px] text-text-3">No leads</div>
        </div>
      ) : (
        <VirtualCardList
          items={leads}
          getKey={(l) => l.id}
          estimateSize={110}
          className="flex-1 overflow-y-auto p-1.5"
          style={{ minHeight: 80, maxHeight: 'calc(100vh - 140px)' }}
          renderItem={(l) => (
            <KanbanCard
              lead={l}
              viewOnly={viewOnly}
              tags={tags}
              sharedFrom={receivedShares[l.id]}
              messageCount={messageCounts[l.id]}
              selected={selectedIds.has(l.id)}
              spotlight={spotlightIds.has(l.id)}
              canSms={canSms}
              onToggleSelect={() => onToggleSelect(l.id)}
              onCall={() => onCall(l.id, l.phone)}
              onText={() => onText(l.id)}
              onOpen={() => onOpen(l.id)}
              onDelete={() => onDelete(l.id)}
            />
          )}
        />
      )}
    </div>
  );
});

// ─── Board ────────────────────────────────────────────────────────────────────

export function KanbanView({ targetUserId, viewOnly = false }: { targetUserId?: string; viewOnly?: boolean }) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const { data: leads = [] } = useLeads(targetUserId);
  const { data: tags = [] } = useTags(targetUserId);
  const { data: receivedShares = {} } = useReceivedLeadShares();
  // SMS is an admin-only feature — no message-count query at all for callers.
  const { data: messageCounts = {} } = useThreadMessageCounts(isAdmin);
  const { data: teamMembers = [] } = useTeamMembers();
  const updateLead = useUpdateLead();
  const deleteLeads = useDeleteLeads();
  const addActivity = useAddActivity();
  const adminShare = useAdminShareLeadToCaller();
  const transferToAdmin = useTransferLeadToAdmin();

  const [search, setSearch] = useState('');
  // The input stays bound to `search` so typing paints immediately; the 4000-lead
  // refilter runs against the deferred copy at lower priority.
  const deferredSearch = useDeferredValue(search);
  const [tagFilter, setTagFilter] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [clearTarget, setClearTarget] = useState<LeadStage | null>(null);
  const [calledId, setCalledId] = useState<string | null>(null);
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteSelected, setShowDeleteSelected] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showBulkSms, setShowBulkSms] = useState(false);
  const sendReminders = useSendReminders();
  const [reminderSummary, setReminderSummary] = useState<string | null>(null);
  const [shareTargetId, setShareTargetId] = useState('');
  const [isSharing, setIsSharing] = useState(false);
  // Optimistic stage overrides — applied immediately on drop, cleared once the
  // cache patch lands so there is no visible snap-back.
  const [optimisticStages, setOptimisticStages] = useState<Record<string, LeadStage>>({});

  // Based on the viewer's own role, not whichever board is being looked at,
  // so an admin sees the same columns whether it's their own board or a
  // team member's.
  const visibleStages = useMemo(() => visibleStagesFor(isAdmin), [isAdmin]);

  // Require 8px movement before drag starts so button clicks aren't accidentally intercepted
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const filtered = useMemo(() => {
    const normalized = normalizeText(deferredSearch);
    const tokens = normalized ? normalized.split(' ') : [];
    const queryDigits = tokens.length ? phoneDigits(deferredSearch) : '';
    return leads
      .map((l) => (optimisticStages[l.id] ? { ...l, stage: optimisticStages[l.id] } : l))
      .filter((l) => {
        if (tagFilter && !l.tagIds.includes(tagFilter)) return false;
        if (tokens.length && !leadMatchesSearch(l, tokens, queryDigits)) return false;
        return true;
      });
  }, [leads, deferredSearch, tagFilter, optimisticStages]);

  // Pre-compute per-stage arrays so each KanbanColumn only re-renders when
  // leads in its own stage change, not when any other stage changes.
  const byStage = useMemo(() => {
    const map = Object.fromEntries(STAGE_ORDER.map((s) => [s, [] as Lead[]])) as Record<LeadStage, Lead[]>;
    for (const lead of filtered) map[lead.stage as LeadStage]?.push(lead);
    return map;
  }, [filtered]);

  // One "spotlight" card per active column — the highest AI Lead Score in
  // that stage, when it's actually strong (65+). Reuses the score already
  // computed on the Lead Profile instead of a made-up highlighting rule;
  // stages with no scored (or only weak) leads simply get no spotlight.
  const spotlightIds = useMemo(() => {
    const ids = new Set<string>();
    for (const stage of STAGE_ORDER) {
      if (DIMMED_STAGES.includes(stage) || stage in CARD_THEME) continue;
      let best: Lead | null = null;
      for (const l of byStage[stage]) {
        if (l.aiScore !== null && l.aiScore >= SPOTLIGHT_MIN_SCORE && (!best || l.aiScore > best.aiScore!)) best = l;
      }
      if (best) ids.add(best.id);
    }
    return ids;
  }, [byStage]);

  // Whoever's leads are actually shown on this board — targetUserId when
  // viewing a team member's board (MemberKanbanPage), otherwise the viewing
  // admin's own. Transferring TO this person is the no-op to exclude, not
  // transferring to the viewer — an admin looking at a caller's board is
  // very much a valid transfer target (pulling the lead into their own
  // pipeline), the same "take" action LeadsPage already offers per-lead.
  const boardOwnerId = targetUserId ?? profile?.id;
  const callers = useMemo(
    () => teamMembers.filter((m) => m.member.role === 'caller' && m.memberId !== boardOwnerId),
    [teamMembers, boardOwnerId],
  );
  // Other admins on the team — excludes whoever currently owns the leads on
  // this board, since transferring a lead to yourself is a no-op. admin_share_lead_to_caller
  // has no server-side role restriction on its target despite the name; the
  // "callers only" behavior has always been purely this UI-layer filter.
  const otherAdmins = useMemo(
    () => teamMembers.filter((m) => m.member.role === 'admin' && m.memberId !== boardOwnerId),
    [teamMembers, boardOwnerId],
  );
  // The founding admin's own account was never "invited" by anyone, so it
  // has no team_members row at all and can never appear in otherAdmins no
  // matter how that list is filtered — team_members only models invitees.
  // "Myself" has to be offered explicitly whenever the board being viewed
  // isn't already the viewer's own (e.g. viewing a caller's board and
  // wanting to pull a lead back into your own pipeline).
  const canTransferToSelf = isAdmin && !!boardOwnerId && boardOwnerId !== profile?.id;

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** Select-all / deselect-all for one column's worth of leads. */
  const handleToggleSelectMany = useCallback((ids: string[], select: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (select) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(filtered.map((l) => l.id)));
  }, [filtered]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  /**
   * Bulk delete over the current selection. Unlike the per-card bin and the
   * column "clear" button — both deliberately limited to Cold Lead, Voicemail
   * and Dead/Declined — this works in any stage, because picking leads out
   * explicitly and confirming a count is a considered act rather than a
   * one-click wipe of an active pipeline column.
   */
  async function handleDeleteSelected() {
    const ids = filtered.filter((l) => selectedIds.has(l.id)).map((l) => l.id);
    setShowDeleteSelected(false);
    if (!ids.length) return;
    setBulkError(null);
    try {
      await deleteLeads.mutateAsync(ids);
      setSelectedIds(new Set());
    } catch (e) {
      setBulkError(
        e instanceof Error
          ? `${e.message} — some leads may not have been deleted.`
          : 'Delete failed. Some leads may not have been deleted.',
      );
    }
  }

  function handleExportCsv() {
    const selectedLeads = filtered.filter((l) => selectedIds.has(l.id));
    exportCsv(selectedLeads, tags);
  }

  async function handleBulkShare() {
    if (!shareTargetId) return;
    setIsSharing(true);
    try {
      const selectedLeads = filtered.filter((l) => selectedIds.has(l.id));
      if (shareTargetId === '__self__') {
        // transfer_lead_to_admin always targets auth.uid() (no p_to_user_id
        // param), which is exactly "myself" here — no separate lookup needed.
        await Promise.all(selectedLeads.map((l) => transferToAdmin.mutateAsync(l.id)));
      } else {
        await Promise.all(
          selectedLeads.map((l) => adminShare.mutateAsync({ leadId: l.id, toUserId: shareTargetId })),
        );
      }
      setShowShareModal(false);
      setShareTargetId('');
      setSelectedIds(new Set());
    } finally {
      setIsSharing(false);
    }
  }

  function handleDragStart(e: DragStartEvent) {
    const lead = leads.find((l) => l.id === e.active.id);
    if (lead) setActiveLead(lead);
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveLead(null);
    const { active, over } = e;
    if (!over) return;
    const lead = leads.find((l) => l.id === active.id);
    const newStage = over.id as LeadStage;
    if (!lead || lead.stage === newStage || !visibleStages.includes(newStage)) return;

    setOptimisticStages((prev) => ({ ...prev, [lead.id]: newStage }));

    const clearOptimistic = () =>
      setOptimisticStages((prev) => {
        const next = { ...prev };
        delete next[lead.id];
        return next;
      });

    updateLead.mutate({ id: lead.id, stage: newStage }, { onSuccess: clearOptimistic, onError: clearOptimistic });
  }

  async function handleClear(stage: LeadStage) {
    const ids = leads.filter((l) => l.stage === stage).map((l) => l.id);
    setClearTarget(null);
    if (!ids.length) return;
    setBulkError(null);
    try {
      await deleteLeads.mutateAsync(ids);
    } catch (e) {
      setBulkError(
        e instanceof Error
          ? `${e.message} — some leads may not have been deleted.`
          : 'Delete failed. Some leads may not have been deleted.',
      );
    }
  }

  const handleCall = useCallback((id: string, phone: string) => {
    addActivity.mutate({ leadId: id, type: 'call', body: 'Quick call logged from Kanban board' });
    setCalledId(id);
    setTimeout(() => setCalledId((prev) => (prev === id ? null : prev)), 1200);
    // Hands off to the Zoom Workplace desktop app to actually place the
    // call — Zoom's own documented deep link, not a generic tel: link, so
    // it launches Zoom Phone specifically rather than whatever else the OS
    // has registered for tel:.
    const e164 = toE164(phone);
    if (e164) window.location.href = `zoomphonecall://${e164}`;
  }, [addActivity]);

  const handleOpen = useCallback((id: string) => {
    navigate(targetUserId ? `/team/${targetUserId}/leads/${id}` : `/leads/${id}`);
  }, [navigate, targetUserId]);

  const handleOpenSms = useCallback((id: string) => {
    navigate(targetUserId ? `/team/${targetUserId}/leads/${id}?tab=sms` : `/leads/${id}?tab=sms`);
  }, [navigate, targetUserId]);

  const selCount = selectedIds.size;

  async function handleSendReminders() {
    setReminderSummary(null);
    try {
      const result = await sendReminders.mutateAsync();
      const parts = [`${result.sent} sent`];
      if (result.rescheduled > 0) parts.push(`${result.rescheduled} rescheduled`);
      if (result.promoted > 0) parts.push(`${result.promoted} moved to Qualified`);
      if (result.declined > 0) parts.push(`${result.declined} moved to Dead (no reply on ownership)`);
      if (result.errors.length > 0) parts.push(`${result.errors.length} failed`);
      setReminderSummary(
        result.totalEligible === 0 ? 'Nobody was due for a reminder right now.' : parts.join(' · '),
      );
    } catch (e) {
      setReminderSummary(e instanceof Error ? e.message : 'Could not send reminders.');
    }
  }

  return (
    <div>
      {/* Title, search/filter and the reminder button all share one row —
          these used to be two full-width rows stacked on top of each
          other, most of it empty space either side of a narrow search box. */}
      <div className="mb-1 flex flex-nowrap items-center justify-between gap-3">
        <div className="shrink-0">
          <h1 className="text-2xl font-semibold text-text">Pipeline</h1>
          <p className="text-sm text-text-3">
            {filtered.length} lead{filtered.length !== 1 ? 's' : ''} across {visibleStages.length} stages
            {viewOnly && ' · you can edit, move, or delete leads here, but not log calls for them'}
          </p>
        </div>
        <div className="flex shrink-0 flex-nowrap items-center gap-2">
          <input
            className="input w-56 shrink"
            placeholder="Search name, phone, or paste a full address…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="input w-[130px] shrink-0" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
            <option value="">All tags</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {isAdmin && !viewOnly && (
            <button
              className="btn btn-sm flex shrink-0 items-center gap-1.5"
              disabled={sendReminders.isPending}
              onClick={handleSendReminders}
              title="Checks every Replied / Partial Qualified lead due for a nudge and texts them about whatever's still outstanding"
            >
              {sendReminders.isPending ? <Loader2 size={13} className="animate-spin" /> : <BellRing size={13} />}
              {sendReminders.isPending ? 'Sending…' : 'Send Reminders'}
            </button>
          )}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-[11px] text-text-3">
        {reminderSummary && <span>{reminderSummary}</span>}
        {calledId && <span className="text-[12px] text-success">✓ Call logged</span>}
      </div>

      {/* ── Bulk-action toolbar ─────────────────────────────────────────────── */}
      {selCount > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="text-[13px] font-semibold text-text">
            {selCount} lead{selCount !== 1 ? 's' : ''} selected
          </span>
          <button
            onClick={handleSelectAll}
            className="text-[12px] text-primary hover:underline"
          >
            Select all {filtered.length}
          </button>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              onClick={handleExportCsv}
              className="btn btn-sm flex items-center gap-1.5"
            >
              <Download size={13} /> Export CSV
            </button>
            {isAdmin && (callers.length > 0 || otherAdmins.length > 0 || canTransferToSelf) && (
              <button
                onClick={() => setShowShareModal(true)}
                className="btn btn-sm btn-primary flex items-center gap-1.5"
              >
                <Users size={13} /> Transfer leads
              </button>
            )}
            {isAdmin && (
              <button
                onClick={() => setShowBulkSms(true)}
                className="btn btn-sm btn-primary flex items-center gap-1.5"
              >
                <MessageSquare size={13} /> Send SMS
              </button>
            )}
            <button
              onClick={() => setShowDeleteSelected(true)}
              disabled={deleteLeads.isPending}
              className="btn btn-sm btn-danger flex items-center gap-1.5"
            >
              <Trash2 size={13} />
              {deleteLeads.isPending ? `Deleting ${selCount}…` : `Delete ${selCount}`}
            </button>
            <button
              onClick={handleClearSelection}
              className="rounded-md p-1 text-text-3 hover:text-text"
              title="Clear selection"
            >
              <XIcon size={15} />
            </button>
          </div>
        </div>
      )}

      {bulkError && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-danger/40 bg-danger-dim px-3 py-2 text-[13px] text-danger">
          <span className="flex-1">{bulkError}</span>
          <button onClick={() => setBulkError(null)} className="shrink-0 hover:opacity-70" title="Dismiss">
            <XIcon size={14} />
          </button>
        </div>
      )}

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex items-start gap-2.5 overflow-x-auto pb-2">
          {visibleStages.map((stage) => (
            <KanbanColumn
              key={stage}
              stage={stage}
              leads={byStage[stage]}
              viewOnly={viewOnly}
              tags={tags}
              receivedShares={receivedShares}
              messageCounts={messageCounts}
              selectedIds={selectedIds}
              spotlightIds={spotlightIds}
              canSms={isAdmin}
              onToggleSelect={handleToggleSelect}
              onToggleSelectMany={handleToggleSelectMany}
              onCall={handleCall}
              onText={handleOpenSms}
              onOpen={handleOpen}
              onDelete={setDeleteTarget}
              setClearTarget={setClearTarget}
            />
          ))}
        </div>

        {/* Portal-based overlay — this is what actually moves under the cursor.
            The card in the column shows a ghost placeholder instead. */}
        <DragOverlay dropAnimation={{ duration: 180, easing: 'ease' }}>
          {activeLead ? (
            <KanbanCardVisual
              lead={activeLead}
              viewOnly={viewOnly}
              tags={tags}
              sharedFrom={receivedShares[activeLead.id]}
              messageCount={messageCounts[activeLead.id]}
              selected={false}
              spotlight={spotlightIds.has(activeLead.id)}
              canSms={isAdmin}
              onToggleSelect={() => {}}
              onCall={() => {}}
              onText={() => {}}
              onOpen={() => {}}
              onDelete={() => {}}
              lifted
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {showBulkSms && (
        <BulkSmsModal
          leads={filtered.filter((l) => selectedIds.has(l.id))}
          onClose={() => setShowBulkSms(false)}
        />
      )}

      {/* ── Share modal ─────────────────────────────────────────────────────── */}
      {showShareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-text">
                Transfer {selCount} lead{selCount !== 1 ? 's' : ''}
              </h2>
              <button onClick={() => setShowShareModal(false)} className="text-text-3 hover:text-text">
                <XIcon size={16} />
              </button>
            </div>
            <select
              className="input w-full"
              value={shareTargetId}
              onChange={(e) => setShareTargetId(e.target.value)}
            >
              <option value="">Select a team member…</option>
              {canTransferToSelf && <option value="__self__">Myself</option>}
              {otherAdmins.length > 0 && (
                <optgroup label="Admins">
                  {otherAdmins.map((m) => (
                    <option key={m.memberId} value={m.memberId}>
                      {m.member.fullName || m.member.email}
                    </option>
                  ))}
                </optgroup>
              )}
              {callers.length > 0 && (
                <optgroup label="Callers">
                  {callers.map((m) => (
                    <option key={m.memberId} value={m.memberId}>
                      {m.member.fullName || m.member.email}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowShareModal(false)}
                className="btn"
                disabled={isSharing}
              >
                Cancel
              </button>
              <button
                onClick={handleBulkShare}
                className="btn btn-primary"
                disabled={!shareTargetId || isSharing}
              >
                {isSharing ? `Transferring…` : `Transfer ${selCount} lead${selCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={showDeleteSelected}
        title={`Delete ${selCount} lead${selCount !== 1 ? 's' : ''}`}
        message={`Permanently delete the ${selCount} selected lead${selCount !== 1 ? 's' : ''}, along with their activity, comps and files? This cannot be undone.`}
        confirmLabel={`Delete ${selCount}`}
        danger
        onCancel={() => setShowDeleteSelected(false)}
        onConfirm={handleDeleteSelected}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete lead"
        message="Permanently delete this lead? This removes it from everywhere and cannot be undone."
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const id = deleteTarget;
          setDeleteTarget(null);
          if (!id) return;
          setBulkError(null);
          deleteLeads
            .mutateAsync([id])
            .catch((e) => setBulkError(e instanceof Error ? e.message : 'Delete failed.'));
        }}
      />
      <ConfirmDialog
        open={!!clearTarget}
        title={`Clear ${clearTarget ? STAGE_CONFIG[clearTarget].label : ''}`}
        message={`Permanently delete all leads in "${clearTarget ? STAGE_CONFIG[clearTarget].label : ''}"? This cannot be undone.`}
        confirmLabel="Delete all"
        danger
        onCancel={() => setClearTarget(null)}
        onConfirm={() => clearTarget && handleClear(clearTarget)}
      />
    </div>
  );
}

export function KanbanPage() {
  return <KanbanView />;
}
