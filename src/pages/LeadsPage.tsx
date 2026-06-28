import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Upload } from 'lucide-react';
import { useLeads } from '@/hooks/useLeads';
import { useTags } from '@/hooks/useTags';
import { StageBadge } from '@/components/ui/StageBadge';
import { StarRating } from '@/components/ui/StarRating';
import { TagPill } from '@/components/ui/TagPill';
import { AddLeadModal } from '@/components/leads/AddLeadModal';
import { ImportCsvModal } from '@/components/leads/ImportCsvModal';
import { DeleteLeadsModal } from '@/components/leads/DeleteLeadsModal';
import { STAGE_CONFIG, type LeadStage } from '@/types/domain';
import { formatPhone } from '@/lib/utils';

export function LeadsView({ targetUserId, viewOnly = false }: { targetUserId?: string; viewOnly?: boolean }) {
  const navigate = useNavigate();
  const { data: leads = [], isLoading } = useLeads(targetUserId);
  const { data: tags = [] } = useTags(targetUserId);

  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<LeadStage | ''>('');
  const [tagFilter, setTagFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return leads.filter((l) => {
      if (stageFilter && l.stage !== stageFilter) return false;
      if (tagFilter && !l.tagIds.includes(tagFilter)) return false;
      if (q) {
        const haystack = `${l.firstName} ${l.lastName} ${l.phone} ${l.address ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [leads, search, stageFilter, tagFilter]);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map((l) => l.id)));
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text">Leads</h1>
          <p className="text-sm text-text-3">
            {leads.length} total{viewOnly && " · this is their lead list - changes apply to their account"}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={() => setShowImport(true)}>
            <Upload size={14} /> Import CSV
          </button>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            <Plus size={14} /> Add Lead
          </button>
        </div>
      </div>

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
        {selected.size === 0 && leads.length > 0 && (
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
                <input type="checkbox" checked={selected.size > 0 && selected.size === filtered.length} onChange={toggleSelectAll} />
              </th>
              <th className="px-3 py-2.5">#</th>
              <th className="px-3 py-2.5">Name</th>
              <th className="px-3 py-2.5">Phone</th>
              <th className="px-3 py-2.5">Address</th>
              <th className="px-3 py-2.5">Stage</th>
              <th className="px-3 py-2.5">Rating</th>
              <th className="px-3 py-2.5">Tags</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-text-3">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-text-3">
                  No leads match your filters.
                </td>
              </tr>
            )}
            {filtered.map((lead) => (
              <tr
                key={lead.id}
                className="cursor-pointer border-b border-border hover:bg-surface-3"
                onClick={() => navigate(targetUserId ? `/team/${targetUserId}/leads/${lead.id}` : `/leads/${lead.id}`)}
              >
                <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(lead.id)} onChange={() => toggleSelected(lead.id)} />
                </td>
                <td className="px-3 py-2.5 text-text-3">{lead.leadNum}</td>
                <td className="px-3 py-2.5 font-medium text-text">
                  {lead.firstName} {lead.lastName}
                </td>
                <td className="px-3 py-2.5 text-text-2">{formatPhone(lead.phone)}</td>
                <td className="max-w-[220px] truncate px-3 py-2.5 text-text-2">{lead.address}</td>
                <td className="px-3 py-2.5">
                  <StageBadge stage={lead.stage} />
                </td>
                <td className="px-3 py-2.5">
                  <StarRating value={lead.rating} size={13} />
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {lead.tagIds.map((tid) => {
                      const tag = tags.find((t) => t.id === tid);
                      return tag ? <TagPill key={tid} tag={tag} /> : null;
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && <AddLeadModal onClose={() => setShowAdd(false)} targetUserId={targetUserId} />}
      {showImport && <ImportCsvModal onClose={() => setShowImport(false)} targetUserId={targetUserId} />}
      {showDelete && <DeleteLeadsModal leads={leads} tags={tags} onClose={() => setShowDelete(false)} />}
    </div>
  );
}

export function LeadsPage() {
  return <LeadsView />;
}
