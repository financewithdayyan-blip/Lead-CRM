import { useMemo, useState } from 'react';
import { Quote } from 'lucide-react';
import { useUpdateLead } from '@/hooks/useLeads';
import { useSignedFileUrls } from '@/hooks/useLeadFiles';
import { formatCurrency, formatPhone, isImageFile } from '@/lib/utils';
import type { Lead } from '@/types/domain';

const TEMPERATURE_LABEL = ['Cold', 'Warm', 'Hot'];

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="card !p-3.5">
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-text-3">{label}</div>
      <div className="mt-1 text-xl font-semibold text-text" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-text-3">{label}</div>
      <div className="mt-0.5 text-[13.5px] font-medium text-text">{value || '—'}</div>
    </div>
  );
}

function LeadInformationCard({ lead }: { lead: Lead }) {
  const updateLead = useUpdateLead();
  const [editing, setEditing] = useState(false);
  const [situation, setSituation] = useState(lead.motivation ?? '');
  const [solution, setSolution] = useState(lead.solution ?? '');
  const [source, setSource] = useState(lead.source ?? '');
  const [temperature, setTemperature] = useState(String(lead.rating ?? 0));
  const [nextStep, setNextStep] = useState(lead.nextStep ?? '');

  function handleSave() {
    updateLead.mutate(
      {
        id: lead.id,
        motivation: situation.trim() || null,
        solution: solution.trim() || null,
        source: source.trim() || null,
        rating: Number(temperature),
        nextStep: nextStep.trim() || null,
      },
      { onSuccess: () => setEditing(false) },
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2 border-b border-border pb-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Lead Information</div>
        <button className="text-[11px] font-medium text-primary hover:underline" onClick={() => setEditing((v) => !v)}>
          {editing ? 'Cancel' : 'Edit'}
        </button>
      </div>

      {!editing ? (
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3.5">
          <InfoCell label="Phone" value={lead.phone ? formatPhone(lead.phone) : ''} />
          <InfoCell label="Situation" value={lead.motivation ?? ''} />
          <InfoCell label="Timeline" value={lead.scriptAnswers?.timeline ?? ''} />
          <InfoCell label="Solution" value={lead.solution ?? ''} />
          <InfoCell label="Source" value={lead.source ?? ''} />
          <InfoCell label="Owner" value={lead.scriptAnswers?.confirmation_owner ?? ''} />
          <InfoCell label="Temperature" value={TEMPERATURE_LABEL[lead.rating] ?? 'Cold'} />
          <InfoCell label="Next Step" value={lead.nextStep ?? ''} />
        </div>
      ) : (
        <div className="mt-3 space-y-2.5">
          <div>
            <label className="label">Situation</label>
            <input className="input" value={situation} onChange={(e) => setSituation(e.target.value)} />
          </div>
          <div>
            <label className="label">Solution</label>
            <input className="input" value={solution} onChange={(e) => setSolution(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="label">Source</label>
              <input className="input" value={source} onChange={(e) => setSource(e.target.value)} />
            </div>
            <div>
              <label className="label">Temperature</label>
              <select className="input" value={temperature} onChange={(e) => setTemperature(e.target.value)}>
                <option value="0">Cold</option>
                <option value="1">Warm</option>
                <option value="2">Hot</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Next Step</label>
            <input className="input" value={nextStep} onChange={(e) => setNextStep(e.target.value)} />
          </div>
          <button className="btn btn-primary w-full" onClick={handleSave} disabled={updateLead.isPending}>
            Save
          </button>
        </div>
      )}
    </div>
  );
}

function PropertySummaryCard({ lead, onJumpToProperty }: { lead: Lead; onJumpToProperty: () => void }) {
  const images = useMemo(() => (lead.files ?? []).filter((f) => isImageFile(f.fileType, f.fileName)), [lead.files]);
  const hero = images[0];
  const { data: urls = {} } = useSignedFileUrls(hero ? [hero.storagePath] : []);
  const heroUrl = hero ? urls[hero.storagePath] : undefined;

  return (
    <div className="card overflow-hidden !p-0">
      <div className="relative aspect-[16/9] bg-surface-3">
        {heroUrl ? (
          <img src={heroUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[12px] text-text-3">No photos yet</div>
        )}
      </div>
      <div className="p-4">
        <div className="text-[15px] font-semibold text-text">{lead.address || 'No address on file'}</div>
        <div className="mt-1 text-[13px] text-text-3">
          {[
            lead.beds != null ? `${lead.beds} bd` : null,
            lead.baths != null ? `${lead.baths} ba` : null,
            lead.sqft != null ? `${lead.sqft.toLocaleString()} sqft` : null,
            lead.propType,
            lead.yearBuilt ? `built ${lead.yearBuilt}` : null,
          ]
            .filter(Boolean)
            .join(' · ') || '—'}
        </div>
        {lead.condition && (
          <div className="mt-1 text-[13px] text-text-3">
            Condition: <span className="font-medium text-text">{lead.condition}</span>
          </div>
        )}
        <button className="mt-2 text-[12.5px] font-medium text-primary hover:underline" onClick={onJumpToProperty}>
          Full property details
        </button>
      </div>
    </div>
  );
}

function QuoteCard({ lead }: { lead: Lead }) {
  const quote = lead.scriptAnswers?.motivation_reason || lead.notes;
  if (!quote) return null;
  return (
    <div className="card">
      <div className="flex items-start gap-2.5">
        <Quote size={16} className="mt-0.5 shrink-0 text-text-3" />
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Their situation, in their words</div>
          <p className="mt-1 text-[13.5px] leading-relaxed text-text-2">{quote}</p>
        </div>
      </div>
    </div>
  );
}

export function OverviewTab({ lead, onJumpToProperty }: { lead: Lead; onJumpToProperty: () => void }) {
  const owed = lead.mortgageBalance;
  const equity = owed != null && lead.arv != null ? lead.arv - owed : null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatBox label="ARV" value={formatCurrency(lead.arv)} />
        <StatBox label="CMV" value={formatCurrency(lead.asIs)} />
        <StatBox label="Owed" value={owed == null || owed === 0 ? 'Paid off' : formatCurrency(owed)} />
        <StatBox label="Est. Equity" value={equity != null ? formatCurrency(equity) : '—'} color="#10b981" />
        <StatBox label="Max Offer" value={lead.maxOffer != null ? formatCurrency(lead.maxOffer) : '—'} />
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <LeadInformationCard lead={lead} />
        <PropertySummaryCard lead={lead} onJumpToProperty={onJumpToProperty} />
      </div>

      <QuoteCard lead={lead} />
    </div>
  );
}
