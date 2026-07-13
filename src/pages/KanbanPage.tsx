import { useMemo, useState } from 'react';
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
import { Phone, Pencil, Share2, Trash2 } from 'lucide-react';
import { useLeads, useDeleteLeads, useUpdateLead } from '@/hooks/useLeads';
import { useTags } from '@/hooks/useTags';
import { useReceivedLeadShares } from '@/hooks/useLeadShares';
import { useAddActivity } from '@/hooks/useActivities';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { TagPill } from '@/components/ui/TagPill';
import { AuctionCountdown } from '@/components/ui/AuctionCountdown';
import { formatPhone, localIsoDate } from '@/lib/utils';
import { isTouchScheduledToday, isTouchedToday, nextScheduledTouchDate, formatTouchDate } from '@/lib/followupSchedule';
import { STAGE_ORDER, STAGE_CONFIG, type Lead, type LeadStage, type Tag } from '@/types/domain';

const CLEARABLE_STAGES: LeadStage[] = ['new', 'voicemail', 'dead_declined'];
const DELETABLE_STAGES: LeadStage[] = ['new', 'voicemail', 'dead_declined'];

// ─── Shared card visual ──────────────────────────────────────────────────────
// Used both in-column (with drag handles) and in the DragOverlay (static copy).

function KanbanCardVisual({
  lead,
  viewOnly,
  tags,
  sharedFrom,
  onCall,
  onOpen,
  onDelete,
  dragProps,
  lifted = false,
}: {
  lead: Lead;
  viewOnly: boolean;
  tags: Tag[];
  sharedFrom?: string;
  onCall: () => void;
  onOpen: () => void;
  onDelete: () => void;
  dragProps?: React.HTMLAttributes<HTMLDivElement>;
  lifted?: boolean;
}) {
  const stars = lead.rating > 0 ? '★'.repeat(lead.rating) + '☆'.repeat(5 - lead.rating) : '';

  return (
    <div
      className={`rounded-md border p-2.5 text-[12px] ${
        sharedFrom ? 'border-info/30 bg-info-dim' : 'border-border-2 bg-surface'
      } ${lifted ? 'rotate-1 shadow-2xl' : 'shadow-card'}`}
      style={lifted ? { willChange: 'transform' } : undefined}
      onDoubleClick={onOpen}
    >
      <div {...dragProps} className={dragProps ? 'cursor-grab active:cursor-grabbing' : undefined}>
        <div className="flex items-start justify-between gap-1">
          <div className="truncate font-medium text-text">
            {lead.firstName} {lead.lastName}
          </div>
          <div className="shrink-0 text-[10px] text-text-3">#{lead.leadNum}</div>
        </div>
        <div className="mt-1 text-text-2">{formatPhone(lead.phone)}</div>
        {lead.address && (
          <div className="mt-0.5 truncate text-text-3" title={lead.address}>
            📍 {lead.address}
          </div>
        )}
        {lead.auctionDate && <AuctionCountdown auctionDate={lead.auctionDate} className="mt-0.5" />}
        {sharedFrom && (
          <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-info/15 px-1.5 py-0.5 text-[10px] font-medium text-info-text">
            <Share2 size={9} /> Shared by {sharedFrom}
          </div>
        )}
        {lead.tagIds.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {lead.tagIds.slice(0, 2).map((tid) => {
              const tag = tags.find((t) => t.id === tid);
              return tag ? <TagPill key={tid} tag={tag} /> : null;
            })}
          </div>
        )}
        {lead.stage === 'followup' &&
          (() => {
            const todayStr = localIsoDate(new Date());
            const dueToday =
              isTouchScheduledToday(lead.followupStartDate, todayStr) &&
              !isTouchedToday(lead.touchDates, todayStr) &&
              lead.touchCount < 10;
            const nextDate = nextScheduledTouchDate(lead.followupStartDate, lead.touchCount, todayStr);
            return (
              <div
                className={`mt-1 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  dueToday ? 'bg-purple-900/40 text-purple-300' : 'bg-surface-3 text-text-3'
                }`}
              >
                <span>{lead.touchCount}/10 touches</span>
                {dueToday ? (
                  <span>· due today</span>
                ) : nextDate ? (
                  <span>· next {formatTouchDate(nextDate)}</span>
                ) : null}
              </div>
            );
          })()}
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <div>{stars && <div className="text-warning">{stars}</div>}</div>
        <div className="flex gap-1">
          {!viewOnly && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCall();
              }}
              className="rounded-md border border-border-2 bg-surface-3 p-1 text-primary hover:border-primary"
              title="Log a call"
            >
              <Phone size={12} />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            className="rounded-md border border-border-2 bg-surface-3 p-1 text-text-2 hover:border-border-2"
            title="Edit"
          >
            <Pencil size={12} />
          </button>
          {DELETABLE_STAGES.includes(lead.stage) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="rounded-md border border-border-2 bg-surface-3 p-1 text-danger hover:border-danger"
              title="Delete"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Draggable card (in-column) ───────────────────────────────────────────────

function KanbanCard({
  lead,
  viewOnly,
  tags,
  sharedFrom,
  onCall,
  onOpen,
  onDelete,
}: {
  lead: Lead;
  viewOnly: boolean;
  tags: Tag[];
  sharedFrom?: string;
  onCall: () => void;
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
          onCall={onCall}
          onOpen={onOpen}
          onDelete={onDelete}
          dragProps={{ ...listeners, ...attributes }}
        />
      )}
    </div>
  );
}

// ─── Column ───────────────────────────────────────────────────────────────────

function KanbanColumn({
  stage,
  leads,
  viewOnly,
  tags,
  receivedShares,
  onCall,
  onOpen,
  onDelete,
  onClear,
}: {
  stage: LeadStage;
  leads: Lead[];
  viewOnly: boolean;
  tags: Tag[];
  receivedShares: Record<string, string>;
  onCall: (id: string) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}) {
  const cfg = STAGE_CONFIG[stage];
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-md border bg-surface-2 ${isOver ? 'border-primary' : 'border-border'}`}
      style={{ borderTopWidth: 3, borderTopColor: cfg.color }}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <span className="h-2 w-2 rounded-full" style={{ background: cfg.color }} />
        <div className="flex-1 text-[13px] font-semibold text-text">{cfg.label}</div>
        <div className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[11px] text-text-3">{leads.length}</div>
        {CLEARABLE_STAGES.includes(stage) && leads.length > 0 && (
          <button onClick={onClear} className="text-text-3 hover:text-danger" title={`Delete all ${cfg.label}`}>
            <Trash2 size={13} />
          </button>
        )}
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2" style={{ minHeight: 80, maxHeight: 'calc(100vh - 230px)' }}>
        {leads.length === 0 && <div className="py-6 text-center text-[12px] text-text-3">No leads</div>}
        {leads.map((l) => (
          <KanbanCard
            key={l.id}
            lead={l}
            viewOnly={viewOnly}
            tags={tags}
            sharedFrom={receivedShares[l.id]}
            onCall={() => onCall(l.id)}
            onOpen={() => onOpen(l.id)}
            onDelete={() => onDelete(l.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Board ────────────────────────────────────────────────────────────────────

export function KanbanView({ targetUserId, viewOnly = false }: { targetUserId?: string; viewOnly?: boolean }) {
  const navigate = useNavigate();
  const { data: leads = [] } = useLeads(targetUserId);
  const { data: tags = [] } = useTags(targetUserId);
  const { data: receivedShares = {} } = useReceivedLeadShares();
  const updateLead = useUpdateLead();
  const deleteLeads = useDeleteLeads();
  const addActivity = useAddActivity();

  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [clearTarget, setClearTarget] = useState<LeadStage | null>(null);
  const [calledId, setCalledId] = useState<string | null>(null);
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  // Optimistic stage overrides — applied immediately on drop, cleared on server settle
  const [optimisticStages, setOptimisticStages] = useState<Record<string, LeadStage>>({});

  // Require 8px movement before drag starts so button clicks aren't accidentally intercepted
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return leads
      .map((l) => (optimisticStages[l.id] ? { ...l, stage: optimisticStages[l.id] } : l))
      .filter((l) => {
        if (tagFilter && !l.tagIds.includes(tagFilter)) return false;
        if (q) {
          const haystack = `${l.firstName} ${l.lastName} ${l.phone} ${l.address ?? ''}`.toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      });
  }, [leads, search, tagFilter, optimisticStages]);

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
    if (!lead || lead.stage === newStage || !STAGE_ORDER.includes(newStage)) return;

    // Move the card to the new column instantly — don't wait for the server
    setOptimisticStages((prev) => ({ ...prev, [lead.id]: newStage }));

    updateLead.mutate(
      { id: lead.id, stage: newStage },
      {
        onSettled: () => {
          // React Query invalidates the cache on settle; remove the override so
          // the real server value (or rollback) takes over cleanly.
          setOptimisticStages((prev) => {
            const next = { ...prev };
            delete next[lead.id];
            return next;
          });
        },
      },
    );
  }

  function handleClear(stage: LeadStage) {
    const ids = leads.filter((l) => l.stage === stage).map((l) => l.id);
    if (ids.length) deleteLeads.mutate(ids);
    setClearTarget(null);
  }

  function handleCall(id: string) {
    addActivity.mutate({ leadId: id, type: 'call', body: 'Quick call logged from Kanban board' });
    setCalledId(id);
    setTimeout(() => setCalledId((prev) => (prev === id ? null : prev)), 1200);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text">Pipeline</h1>
          <p className="text-sm text-text-3">
            {filtered.length} lead{filtered.length !== 1 ? 's' : ''} across {STAGE_ORDER.length} stages
            {viewOnly && ' · you can edit, move, or delete leads here, but not log calls for them'}
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder="Search name, phone, address…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input max-w-[160px]" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {calledId && <span className="text-[12px] text-success">✓ Call logged</span>}
      </div>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {STAGE_ORDER.map((stage) => (
            <KanbanColumn
              key={stage}
              stage={stage}
              leads={filtered.filter((l) => l.stage === stage)}
              viewOnly={viewOnly}
              tags={tags}
              receivedShares={receivedShares}
              onCall={handleCall}
              onOpen={(id) => navigate(targetUserId ? `/team/${targetUserId}/leads/${id}` : `/leads/${id}`)}
              onDelete={setDeleteTarget}
              onClear={() => setClearTarget(stage)}
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
              onCall={() => {}}
              onOpen={() => {}}
              onDelete={() => {}}
              lifted
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete lead"
        message="Permanently delete this lead? This removes it from everywhere and cannot be undone."
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteLeads.mutate([deleteTarget]);
          setDeleteTarget(null);
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
