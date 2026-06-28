import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core';
import { Phone, Pencil, Trash2 } from 'lucide-react';
import { useLeads, useDeleteLeads, useUpdateLead } from '@/hooks/useLeads';
import { useTags } from '@/hooks/useTags';
import { useAddActivity } from '@/hooks/useActivities';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { TagPill } from '@/components/ui/TagPill';
import { formatPhone } from '@/lib/utils';
import { STAGE_ORDER, STAGE_CONFIG, type Lead, type LeadStage } from '@/types/domain';

const CLEARABLE_STAGES: LeadStage[] = ['new', 'voicemail', 'dead_declined'];
const DELETABLE_STAGES: LeadStage[] = ['new', 'voicemail', 'dead_declined'];

function KanbanCard({
  lead,
  viewOnly,
  onCall,
  onOpen,
  onDelete,
}: {
  lead: Lead;
  viewOnly: boolean;
  onCall: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { data: tags = [] } = useTags();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 } : undefined;
  const stars = lead.rating > 0 ? '★'.repeat(lead.rating) + '☆'.repeat(5 - lead.rating) : '';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-md border border-border-2 bg-surface p-2.5 text-[12px] shadow-card ${isDragging ? 'opacity-50' : ''}`}
      onDoubleClick={onOpen}
    >
      <div {...listeners} {...attributes} className="cursor-grab active:cursor-grabbing">
        <div className="flex items-start justify-between gap-1">
          <div className="truncate font-medium text-text">
            {lead.firstName} {lead.lastName}
          </div>
          <div className="shrink-0 text-[10px] text-text-3">#{lead.leadNum}</div>
        </div>
        <div className="mt-1 text-text-2">{formatPhone(lead.phone)}</div>
        {lead.address && <div className="mt-0.5 truncate text-text-3" title={lead.address}>📍 {lead.address}</div>}
        {lead.tagIds.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {lead.tagIds.slice(0, 2).map((tid) => {
              const tag = tags.find((t) => t.id === tid);
              return tag ? <TagPill key={tid} tag={tag} /> : null;
            })}
          </div>
        )}
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

function KanbanColumn({
  stage,
  leads,
  viewOnly,
  onCall,
  onOpen,
  onDelete,
  onClear,
}: {
  stage: LeadStage;
  leads: Lead[];
  viewOnly: boolean;
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
            onCall={() => onCall(l.id)}
            onOpen={() => onOpen(l.id)}
            onDelete={() => onDelete(l.id)}
          />
        ))}
      </div>
    </div>
  );
}

export function KanbanView({ targetUserId, viewOnly = false }: { targetUserId?: string; viewOnly?: boolean }) {
  const navigate = useNavigate();
  const { data: leads = [] } = useLeads(targetUserId);
  const { data: tags = [] } = useTags(targetUserId);
  const updateLead = useUpdateLead();
  const deleteLeads = useDeleteLeads();
  const addActivity = useAddActivity();

  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [clearTarget, setClearTarget] = useState<LeadStage | null>(null);
  const [calledId, setCalledId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return leads.filter((l) => {
      if (tagFilter && !l.tagIds.includes(tagFilter)) return false;
      if (q) {
        const haystack = `${l.firstName} ${l.lastName} ${l.phone} ${l.address ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [leads, search, tagFilter]);

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;
    const lead = leads.find((l) => l.id === active.id);
    const newStage = over.id as LeadStage;
    if (!lead || lead.stage === newStage || !STAGE_ORDER.includes(newStage)) return;
    updateLead.mutate({ id: lead.id, stage: newStage });
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
        <input className="input max-w-xs" placeholder="Search name, phone, address…" value={search} onChange={(e) => setSearch(e.target.value)} />
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

      <DndContext onDragEnd={handleDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {STAGE_ORDER.map((stage) => (
            <KanbanColumn
              key={stage}
              stage={stage}
              leads={filtered.filter((l) => l.stage === stage)}
              viewOnly={viewOnly}
              onCall={handleCall}
              onOpen={(id) => navigate(targetUserId ? `/team/${targetUserId}/leads/${id}` : `/leads/${id}`)}
              onDelete={setDeleteTarget}
              onClear={() => setClearTarget(stage)}
            />
          ))}
        </div>
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
