import { useState } from 'react';
import { useUpdateLead } from '@/hooks/useLeads';
import { useContractInstancesForLead } from '@/hooks/useContractInstances';
import { formatCurrency } from '@/lib/utils';
import type { Lead } from '@/types/domain';

export function OfferSummaryStrip({ lead }: { lead: Lead }) {
  const updateLead = useUpdateLead();
  const { data: instances = [] } = useContractInstancesForLead(lead.id);
  const sent = instances.length > 0;
  const [editing, setEditing] = useState(false);
  const [maxOffer, setMaxOffer] = useState(lead.maxOffer?.toString() ?? '');
  const [terms, setTerms] = useState(lead.offerTerms ?? '');

  function handleSave() {
    updateLead.mutate(
      { id: lead.id, maxOffer: maxOffer.trim() ? Number(maxOffer) : null, offerTerms: terms.trim() || null },
      { onSuccess: () => setEditing(false) },
    );
  }

  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Offer · Cash Offer</div>
          {!editing ? (
            <>
              <div className="mt-0.5 text-2xl font-semibold text-text">{lead.maxOffer != null ? formatCurrency(lead.maxOffer) : '—'}</div>
              {lead.offerTerms && <div className="mt-0.5 text-[12.5px] text-text-3">{lead.offerTerms}</div>}
            </>
          ) : (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <input className="input !w-32" inputMode="decimal" placeholder="Offer $" value={maxOffer} onChange={(e) => setMaxOffer(e.target.value.replace(/[^0-9.]/g, ''))} />
              <input className="input flex-1" placeholder="Terms, e.g. All cash, 21-day close, as-is" value={terms} onChange={(e) => setTerms(e.target.value)} />
              <button className="btn btn-primary !px-3 !py-1.5 text-[12.5px]" onClick={handleSave} disabled={updateLead.isPending}>
                Save
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${sent ? 'bg-success-dim text-success' : 'bg-surface-3 text-text-3'}`}>
            {sent ? 'Sent' : 'Not sent yet'}
          </span>
          {!editing && (
            <button className="text-[11px] font-medium text-primary hover:underline" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
