import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Mail, X } from 'lucide-react';
import { useContactedStageLeads } from '@/hooks/useLeads';
import { useTags } from '@/hooks/useTags';
import { TagPill } from '@/components/ui/TagPill';
import { BulkEmailModal } from '@/components/email/BulkEmailModal';
import { formatPhone, leadDisplayName } from '@/lib/utils';

/** Bulk Email's own lead picker — scoped to the Contacted stage only. Most
 *  leads reply over SMS once contacted; the ones who don't are exactly who
 *  a bulk email follow-up is for, so this page (not the Kanban board, which
 *  is where Bulk SMS picks leads from) is the one place Bulk Email can be
 *  started from. */
export function ContactedLeadsPage() {
  const { data: leads = [], isLoading } = useContactedStageLeads();
  const { data: tags = [] } = useTags();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);

  const selectedLeads = useMemo(() => leads.filter((l) => selectedIds.has(l.id)), [leads, selectedIds]);
  const allSelected = leads.length > 0 && selectedIds.size === leads.length;

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(leads.map((l) => l.id)));
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-text">
            <Mail size={20} /> Bulk Email
          </h1>
          <p className="text-sm text-text-3">
            Contacted leads only — most people reply over SMS; these are the ones who haven't, worth a follow-up by
            email too.
          </p>
        </div>
        <Link to="/bulk-email/history" className="btn">
          View Past Sends
        </Link>
      </div>

      {selectedIds.size > 0 && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-primary/40 bg-primary/5 px-4 py-2.5">
          <span className="text-[13px] font-medium text-text">{selectedIds.size} selected</span>
          <div className="flex items-center gap-3">
            <button className="btn btn-primary !py-1.5" onClick={() => setModalOpen(true)}>
              <Mail size={13} /> Send Bulk Email
            </button>
            <button
              className="flex items-center gap-1 text-[12.5px] text-text-3 hover:text-text"
              onClick={() => setSelectedIds(new Set())}
            >
              <X size={13} /> Clear
            </button>
          </div>
        </div>
      )}

      <div className="card !p-0 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center gap-2 p-8 text-[13px] text-text-3">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : leads.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-text-3">No leads in the Contacted stage right now.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border-2 text-left text-[11px] font-semibold uppercase tracking-wide text-text-3">
                  <th className="w-10 px-3 py-2.5">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-3.5 w-3.5 accent-primary" />
                  </th>
                  <th className="px-3 py-2.5">Lead</th>
                  <th className="px-3 py-2.5">Phone</th>
                  <th className="px-3 py-2.5">Email</th>
                  <th className="px-3 py-2.5">Address</th>
                  <th className="px-3 py-2.5">Tags</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => {
                  const leadTags = lead.tagIds.map((tid) => tags.find((t) => t.id === tid)).filter((t): t is NonNullable<typeof t> => !!t);
                  return (
                    <tr key={lead.id} className="border-b border-border-2 last:border-0 hover:bg-surface-3">
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(lead.id)}
                          onChange={() => toggleOne(lead.id)}
                          className="h-3.5 w-3.5 accent-primary"
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <Link to={`/leads/${lead.id}`} className="font-medium text-text hover:text-primary hover:underline">
                          {leadDisplayName(lead.firstName, lead.lastName) || 'Lead'}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-text-2">{lead.phone ? formatPhone(lead.phone) : '—'}</td>
                      <td className="px-3 py-2.5 text-text-2">
                        {lead.email ? (
                          lead.emailOptedOut ? (
                            <span className="text-text-3" title="Unsubscribed from bulk email">
                              {lead.email} (unsubscribed)
                            </span>
                          ) : (
                            lead.email
                          )
                        ) : (
                          <span className="text-text-3">No email</span>
                        )}
                      </td>
                      <td className="max-w-[220px] truncate px-3 py-2.5 text-text-2" title={lead.address ?? undefined}>
                        {lead.address || '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {leadTags.map((t) => (
                            <TagPill key={t.id} tag={t} />
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && <BulkEmailModal leads={selectedLeads} onClose={() => setModalOpen(false)} />}
    </div>
  );
}
