import { Suspense, lazy, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Share2, Trash2, Upload, UserPlus } from 'lucide-react';
import { useLeadsPage, useLeadsTotalCount } from '@/hooks/useLeads';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useTags } from '@/hooks/useTags';
import { useReceivedLeadShares, useTransferLeadToAdmin } from '@/hooks/useLeadShares';
import { StageBadge } from '@/components/ui/StageBadge';
import { TagPill } from '@/components/ui/TagPill';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AuctionCountdown } from '@/components/ui/AuctionCountdown';
import { AddLeadModal } from '@/components/leads/AddLeadModal';
import { DeleteLeadsModal } from '@/components/leads/DeleteLeadsModal';
import { STAGE_CONFIG, type LeadStage } from '@/types/domain';
import { cn, formatPhone, getErrorMessage, initials } from '@/lib/utils';

// Lazy — pulls in the xlsx (SheetJS) library, which is heavy and only ever
// needed once someone actually opens the import modal, not on every visit
// to the Leads page.
const ImportCsvModal = lazy(() => import('@/components/leads/ImportCsvModal').then((m) => ({ default: m.ImportCsvModal })));

// A stable (never changes between renders/reloads), evenly-distributed color
// per lead for its avatar circle — hashed from the lead's own id, not random,
// so the same lead always gets the same color.
const AVATAR_PALETTE = [
  { bg: 'rgba(255,181,71,.15)', text: '#FFC46B' },
  { bg: 'rgba(110,123,255,.18)', text: '#A9B1FF' },
  { bg: 'rgba(61,214,181,.14)', text: '#4FE0BF' },
  { bg: 'rgba(90,184,255,.14)', text: '#7CC6FF' },
  { bg: 'rgba(180,140,255,.15)', text: '#C7A8FF' },
  { bg: 'rgba(255,107,107,.13)', text: '#FF8A8A' },
];
function avatarColorFor(id: string): { bg: string; text: string } {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

// Real ai_score (0-100, see score-lead/auto-score-leads) — thresholds are a
// visual read only, not a different stored value.
function scoreColor(score: number | null): string | undefined {
  if (score == null) return undefined;
  if (score >= 75) return '#4FE0BF';
  if (score >= 50) return '#FFC46B';
  return undefined;
}

export function LeadsView({ targetUserId, viewOnly = false }: { targetUserId?: string; viewOnly?: boolean }) {
  const navigate = useNavigate();
  const { data: totalCount = 0 } = useLeadsTotalCount(targetUserId);
  const { data: tags = [] } = useTags(targetUserId);
  const { data: receivedShares = {} } = useReceivedLeadShares();
  const transferLead = useTransferLeadToAdmin();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [stageFilter, setStageFilter] = useState<LeadStage | ''>('');
  const [tagFilter, setTagFilter] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 200;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [takeTarget, setTakeTarget] = useState<{ id: string; name: string } | null>(null);

  const {
    data: pageResult,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = useLeadsPage(targetUserId, page, debouncedSearch, stageFilter, tagFilter);
  const leads = pageResult?.rows ?? [];
  const filteredCount = pageResult?.count ?? 0;

  useEffect(() => { setPage(1); }, [debouncedSearch, stageFilter, tagFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  // Selects only the rows on the current page — with results now paginated
  // server-side, "every lead matching the filters across the whole account"
  // is what DeleteLeadsModal's "By filter" mode is for.
  function toggleSelectAll() {
    setSelected(selected.size === leads.length ? new Set() : new Set(leads.map((l) => l.id)));
  }

  function paginationPages(): (number | '…')[] {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const items: (number | '…')[] = [1];
    if (page > 3) items.push('…');
    for (let p = Math.max(2, page - 1); p <= Math.min(totalPages - 1, page + 1); p++) items.push(p);
    if (page < totalPages - 2) items.push('…');
    items.push(totalPages);
    return items;
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text">Leads</h1>
          <p className="mt-1 text-sm text-text-3">
            {isError ? 'Failed to load' : <><span className="font-mono text-text-2">{totalCount.toLocaleString()}</span> total</>}
            {viewOnly && " · this is their lead list - changes apply to their account"}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={() => setShowImport(true)}>
            <Upload size={14} /> Import Leads
          </button>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            <Plus size={14} /> Add Lead
          </button>
        </div>
      </div>

      {isError && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-danger/40 bg-danger-dim px-3 py-2.5 text-[13px] text-danger">
          <span>
            Couldn't load your leads: {getErrorMessage(error, 'unknown error')}. Your data is safe — this is a
            connection problem, not data loss.
          </span>
          <button className="btn shrink-0" onClick={() => refetch()} disabled={isRefetching}>
            {isRefetching ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search name, phone, address…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input max-w-[180px]" value={stageFilter} onChange={(e) => setStageFilter(e.target.value as LeadStage | '')}>
          <option value="">All stages</option>
          {Object.entries(STAGE_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <select className="input max-w-[160px]" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {selected.size > 0 && (
          <button className="btn btn-danger ml-auto" onClick={() => setShowDelete(true)}>
            <Trash2 size={14} /> Delete {selected.size}
          </button>
        )}
        {selected.size === 0 && totalCount > 0 && (
          <button className="btn ml-auto" onClick={() => setShowDelete(true)}>
            <Trash2 size={14} /> Manage / bulk delete
          </button>
        )}
      </div>

      <div className="card overflow-x-auto !p-0">
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-border bg-surface-3 text-[11px] uppercase tracking-wide text-text-3">
            <tr>
              <th className="px-3 py-2.5">
                <input type="checkbox" checked={selected.size > 0 && selected.size === leads.length} onChange={toggleSelectAll} />
              </th>
              <th className="px-3 py-2.5">#</th>
              <th className="px-3 py-2.5">Lead</th>
              <th className="px-3 py-2.5">Property</th>
              <th className="px-3 py-2.5">Tags</th>
              <th className="px-3 py-2.5">Stage</th>
              <th className="px-3 py-2.5">Auction</th>
              <th className="px-3 py-2.5 text-right">Score</th>
              {targetUserId && <th className="px-3 py-2.5" />}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={targetUserId ? 9 : 8} className="px-3 py-8 text-center text-text-3">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && leads.length === 0 && (
              <tr>
                <td colSpan={targetUserId ? 9 : 8} className="px-3 py-8 text-center text-text-3">
                  No leads match your filters.
                </td>
              </tr>
            )}
            {leads.map((lead) => {
              const sharedFrom = receivedShares[lead.id];
              const isSelected = selected.has(lead.id);
              const avatar = avatarColorFor(lead.id);
              const cityState = [lead.city, lead.state].filter(Boolean).join(', ');
              const score = scoreColor(lead.aiScore);
              return (
                <tr
                  key={lead.id}
                  className={cn(
                    'cursor-pointer border-b border-border',
                    sharedFrom ? 'bg-info-dim hover:bg-info/15' : isSelected ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-surface-3',
                  )}
                  onClick={() => navigate(targetUserId ? `/team/${targetUserId}/leads/${lead.id}` : `/leads/${lead.id}`)}
                >
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelected(lead.id)} />
                  </td>
                  <td className="px-3 py-2.5 text-text-3">{lead.leadNum}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <span
                        className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
                        style={{ background: avatar.bg, color: avatar.text }}
                      >
                        {initials(lead.firstName, lead.lastName)}
                      </span>
                      <div className="min-w-0">
                        <div className="font-semibold text-text">
                          {lead.firstName} {lead.lastName}
                        </div>
                        <div className="font-mono text-[12.5px] text-text-3">{formatPhone(lead.phone || lead.phone2 || '')}</div>
                        {sharedFrom && (
                          <div className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-info/15 px-1.5 py-0.5 text-[10px] font-medium text-info-text">
                            <Share2 size={9} /> Shared by {sharedFrom}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="max-w-[220px] px-3 py-2.5 text-text-2">
                    <div className="truncate">{lead.address}</div>
                    {cityState && <div className="truncate text-[12.5px] text-text-3">{cityState}</div>}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {lead.tagIds.map((tid) => {
                        const tag = tags.find((t) => t.id === tid);
                        return tag ? <TagPill key={tid} tag={tag} /> : null;
                      })}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <StageBadge stage={lead.stage} />
                  </td>
                  <td className="px-3 py-2.5">
                    {lead.auctionDate ? <AuctionCountdown auctionDate={lead.auctionDate} /> : <span className="text-text-3">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono font-bold" style={score ? { color: score } : undefined}>
                    {lead.aiScore ?? <span className="text-text-3">—</span>}
                  </td>
                  {targetUserId && (
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="btn !px-2.5 !py-1 text-[12px]"
                        title="Take this lead into your own pipeline"
                        onClick={() => setTakeTarget({ id: lead.id, name: `${lead.firstName} ${lead.lastName}` })}
                      >
                        <UserPlus size={13} /> Take
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-[13px] text-text-2">
          <span>
            Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, filteredCount)} of {filteredCount}
          </span>
          <div className="flex items-center gap-1">
            <button
              className="btn !px-2.5 !py-1"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ‹ Prev
            </button>
            {paginationPages().map((item, i) =>
              item === '…' ? (
                <span key={`e${i}`} className="px-1 text-text-3">…</span>
              ) : (
                <button
                  key={item}
                  onClick={() => setPage(item as number)}
                  className={`btn !px-2.5 !py-1 ${page === item ? 'btn-primary' : ''}`}
                >
                  {item}
                </button>
              )
            )}
            <button
              className="btn !px-2.5 !py-1"
              disabled={page === totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next ›
            </button>
          </div>
        </div>
      )}

      {showAdd && <AddLeadModal onClose={() => setShowAdd(false)} targetUserId={targetUserId} />}
      {showImport && (
        <Suspense fallback={null}>
          <ImportCsvModal onClose={() => setShowImport(false)} targetUserId={targetUserId} />
        </Suspense>
      )}
      {showDelete && (
        <DeleteLeadsModal
          selectedLeads={leads.filter((l) => selected.has(l.id))}
          tags={tags}
          targetUserId={targetUserId}
          onClose={() => { setShowDelete(false); setSelected(new Set()); }}
        />
      )}

      <ConfirmDialog
        open={!!takeTarget}
        title="Take this lead?"
        message={`${takeTarget?.name} will move into your own pipeline and out of theirs, keeping its current stage and full history.`}
        confirmLabel="Take lead"
        onCancel={() => setTakeTarget(null)}
        onConfirm={() => {
          if (takeTarget) transferLead.mutate(takeTarget.id);
          setTakeTarget(null);
        }}
      />
    </div>
  );
}

export function LeadsPage() {
  return <LeadsView />;
}
