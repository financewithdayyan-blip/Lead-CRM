import { useMemo, useState } from 'react';
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core';
import { Phone, Pencil, Trash2 } from 'lucide-react';
import { useLeads, useDeleteLeads, useUpdateLead } from '@/hooks/useLeads';
import { useTags } from '@/hooks/useTags';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LeadDetailModal } from '@/components/leads/LeadDetailModal';
import { SessionMode } from '@/components/session/SessionMode';
import { TagPill } from '@/components/ui/TagPill';
import { formatPhone } from '@/lib/utils';
import type { Lead, LeadStatus } from '@/types/domain';

const KB_COLUMNS: Array<{ key: string; label: string; color: string; statuses: LeadStatus[]; clearable?: boolean }> = [
  { key: 'new', label: 'Cold Leads', color: '#2ddfc8', statuses: ['new'], clearable: true },
  { key: 'voicemail', label: 'Voicemail', color: '#f5a524', statuses: ['voicemail'], clearable: true },
  { key: 'followup', label: 'Initial Contact', color: '#b08afa', statuses: ['followup'] },
  { key: 'followups', label: 'Follow-Ups', color: '#c084fc', statuses: ['followup2', 'followup3'] },
  { key: 'negotiating', label: 'Negotiating', color: '#fb923c', statuses: ['negotiating'] },
  { key: 'contract', label: 'Contract', color: '#22c97b', statuses: ['contract'] },
  { key: 'dead', label: 'Dead', color: '#f05252', statuses: ['dead'], clearable: true },
  { key: 'declined', label: 'Declined', color: '#ff8c4b', statuses: ['declined'], clearable: true },
  { key: 'onhold', label: 'On Hold', color: '#2dd4bf', statuses: ['onhold'] },
];

const DELETABLE_STATUSES: LeadStatus[] = ['new', 'voicemail', 'dead', 'declined'];

function KanbanCard({ lead, onCall, onOpen, onDelete }: { lead: Lead; onCall: () => void; onOpen: () => void; onDelete: () => void }) {
  const { data: tags = [] } = useTags();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 } : undefined;
  const stars = lead.rating > 0 ? '★'.repeat(lead.rating) + '☆'.repeat(5 - lead.rating) : '';
  const dateStr = lead.calledAt ? new Date(lead.calledAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-md border border-border-2 bg-surface-3 p-2.5 text-[12px] ${isDragging ? 'opacity-50' : ''}`}
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
        <div>
          {stars && <div className="text-amber">{stars}</div>}
          {dateStr && <div className="text-[10px] text-text-3">{dateStr}</div>}
        </div>
        <div className="flex gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCall();
            }}
            className="rounded-md border border-border-2 bg-surface-4 p-1 text-blue-bright hover:border-blue"
            title="Call"
          >
            <Phone size={12} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            className="rounded-md border border-border-2 bg-surface-4 p-1 text-text-2 hover:border-border-3"
            title="Edit"
          >
            <Pencil size={12} />
          </button>
          {DELETABLE_STATUSES.includes(lead.status) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="rounded-md border border-border-2 bg-surface-4 p-1 text-red hover:border-red"
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
  col,
  leads,
  onCall,
  onOpen,
  onDelete,
  onClear,
}: {
  col: (typeof KB_COLUMNS)[number];
  leads: Lead[];
  onCall: (id: string) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key });
  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-md border bg-surface ${isOver ? 'border-blue' : 'border-border'}`}
      style={{ borderTopWidth: 3, borderTopColor: col.color }}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <span className="h-2 w-2 rounded-full" style={{ background: col.color }} />
        <div className="flex-1 text-[13px] font-semibold text-text">{col.label}</div>
        <div className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[11px] text-text-3">{leads.length}</div>
        {col.clearable && leads.length > 0 && (
          <button onClick={onClear} className="text-text-3 hover:text-red" title={`Delete all ${col.label}`}>
            <Trash2 size={13} />
          </button>
        )}
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2" style={{ minHeight: 80, maxHeight: 'calc(100vh - 230px)' }}>
        {leads.length === 0 && <div className="py-6 text-center text-[12px] text-text-3">No leads</div>}
        {leads.map((l) => (
          <KanbanCard key={l.id} lead={l} onCall={() => onCall(l.id)} onOpen={() => onOpen(l.id)} onDelete={() => onDelete(l.id)} />
        ))}
      </div>
    </div>
  );
}

export function KanbanPage() {
  const { data: leads = [] } = useLeads();
  const { data: tags = [] } = useTags();
  const updateLead = useUpdateLead();
  const deleteLeads = useDeleteLeads();

  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  const [sessionLeadId, setSessionLeadId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [clearTarget, setClearTarget] = useState<(typeof KB_COLUMNS)[number] | null>(null);

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
    const col = KB_COLUMNS.find((c) => c.key === over.id);
    if (!lead || !col) return;
    const newStatus = col.statuses[0];
    if (lead.status === newStatus || col.statuses.includes(lead.status)) return;
    updateLead.mutate({ id: lead.id, status: newStatus, calledAt: new Date().toISOString() });
  }

  function handleClear(col: (typeof KB_COLUMNS)[number]) {
    const ids = leads.filter((l) => col.statuses.includes(l.status)).map((l) => l.id);
    if (ids.length) deleteLeads.mutate(ids);
    setClearTarget(null);
  }

  const sessionLead = sessionLeadId ? leads.filter((l) => l.id === sessionLeadId) : [];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-text">Kanban Board</h1>
          <p className="text-sm text-text-3">
            {filtered.length} lead{filtered.length !== 1 ? 's' : ''} across {KB_COLUMNS.length} columns
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
      </div>

      <DndContext onDragEnd={handleDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {KB_COLUMNS.map((col) => (
            <KanbanColumn
              key={col.key}
              col={col}
              leads={filtered.filter((l) => col.statuses.includes(l.status))}
              onCall={setSessionLeadId}
              onOpen={setOpenLeadId}
              onDelete={setDeleteTarget}
              onClear={() => setClearTarget(col)}
            />
          ))}
        </div>
      </DndContext>

      {openLeadId && <LeadDetailModal leadId={openLeadId} onClose={() => setOpenLeadId(null)} />}
      {sessionLeadId && sessionLead.length > 0 && <SessionMode leads={sessionLead} startLeadId={sessionLeadId} onClose={() => setSessionLeadId(null)} />}

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
        title={`Clear ${clearTarget?.label ?? ''}`}
        message={`Permanently delete all leads in "${clearTarget?.label}"? This cannot be undone.`}
        confirmLabel="Delete all"
        danger
        onCancel={() => setClearTarget(null)}
        onConfirm={() => clearTarget && handleClear(clearTarget)}
      />
    </div>
  );
}
