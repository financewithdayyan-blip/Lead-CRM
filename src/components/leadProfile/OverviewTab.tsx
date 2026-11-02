import { useMemo, useState } from 'react';
import { Archive, Images, NotebookText, Send } from 'lucide-react';
import { useUpdateLead } from '@/hooks/useLeads';
import { useSignedFileUrls } from '@/hooks/useLeadFiles';
import { useActivities, useAddActivity } from '@/hooks/useActivities';
import { EditableField } from '@/components/leadProfile/EditableField';
import { currencyDigitsOnly, formatCurrency, formatDate, formatDateTime, isImageFile } from '@/lib/utils';
import type { Lead } from '@/types/domain';

const TEMPERATURE_LABEL = ['Cold', 'Warm', 'Hot'];
const TEMPERATURE_OPTIONS = [
  { value: '0', label: 'Cold' },
  { value: '1', label: 'Warm' },
  { value: '2', label: 'Hot' },
];

const OCCUPANCY_LABEL: Record<string, string> = {
  owner_occupied: 'Owner occupied',
  tenant_occupied: 'Tenant occupied',
  vacant: 'Vacant',
};
const OCCUPANCY_OPTIONS = [
  { value: '', label: '—' },
  { value: 'owner_occupied', label: 'Owner occupied' },
  { value: 'tenant_occupied', label: 'Tenant occupied' },
  { value: 'vacant', label: 'Vacant' },
];

/** One boxed cell in the Lead Information grid — same EditableField
 * click-to-edit behavior as before, just given its own tinted box instead
 * of sitting bare in the grid, to read as a set of distinct facts. */
function InfoCell(props: React.ComponentProps<typeof EditableField>) {
  return (
    <div className="rounded-md bg-surface-3 px-3.5 py-3">
      <EditableField {...props} />
    </div>
  );
}

/** The mockup's "Where the deal stands" shows a 3-point bar — your current
 * offer, their asking price, and your max offer — but this CRM has no field
 * for a live "current offer" distinct from Max Offer, so this is the honest
 * 2-point version: Asking vs. Max Offer, both real lead fields already
 * shown elsewhere on this tab (just not compared against each other). */
function DealStandsCard({ lead }: { lead: Lead }) {
  const asking = lead.askingPrice;
  const maxOffer = lead.maxOffer;
  if (asking == null && maxOffer == null) return null;

  if (asking == null || maxOffer == null) {
    return (
      <div className="card !p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Where the deal stands</div>
        <div className="mt-1.5 text-[13px] text-text-2">
          {asking != null ? (
            <>Asking <b className="font-mono text-text">{formatCurrency(asking)}</b></>
          ) : (
            <>Max offer <b className="font-mono text-text">{formatCurrency(maxOffer)}</b></>
          )}
          {' — set '}
          {asking == null ? 'an asking price' : 'a max offer'} to see the gap.
        </div>
      </div>
    );
  }

  const gap = asking - maxOffer;
  const over = gap > 0;
  const gapColor = over ? '#ef4444' : '#10b981';
  const lo = Math.min(asking, maxOffer);
  const hi = Math.max(asking, maxOffer);
  const span = Math.max(hi - lo, 1);
  const pad = span * 0.35 + 2000;
  const scaleMin = lo - pad;
  const scaleMax = hi + pad;
  const pct = (v: number) => ((v - scaleMin) / (scaleMax - scaleMin)) * 100;

  return (
    <div className="card !p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Where the deal stands</div>
        <div className="font-mono text-[11px] text-text-3">
          {formatCurrency(scaleMin)} to {formatCurrency(scaleMax)}
        </div>
      </div>

      <div className="relative mt-5 h-2 rounded-full bg-surface-3">
        <div
          className="absolute h-2 rounded-full"
          style={{ left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%`, background: `${gapColor}55` }}
        />
        <div className="absolute top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-primary" style={{ left: `${pct(maxOffer)}%` }} />
        <div className="absolute top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full" style={{ left: `${pct(asking)}%`, background: gapColor }} />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[12px]">
        <span className="flex items-center gap-1.5 text-text-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
          Max offer <b className="font-mono text-text">{formatCurrency(maxOffer)}</b>
        </span>
        <span className="flex items-center gap-1.5 text-text-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: gapColor }} />
          Asking <b className="font-mono text-text">{formatCurrency(asking)}</b>
        </span>
      </div>

      <div className="mt-2 text-[12.5px] font-medium" style={{ color: gapColor }}>
        {gap === 0
          ? 'Asking matches your max offer exactly.'
          : over
            ? `Asking is ${formatCurrency(gap)} over your max offer.`
            : `${formatCurrency(-gap)} of room between your max offer and asking.`}
      </div>
    </div>
  );
}

function LeadInformationCard({ lead }: { lead: Lead }) {
  const updateLead = useUpdateLead();

  function saveField(patch: Partial<Lead>) {
    updateLead.mutate({ id: lead.id, ...patch });
  }

  function saveScriptAnswer(key: 'timeline' | 'confirmation_owner', value: string) {
    saveField({ scriptAnswers: { ...lead.scriptAnswers, [key]: value || undefined } });
  }

  return (
    <div className="card">
      <div className="border-b border-border pb-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
        Lead Information
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {/* One mutation shared by every field below — disabling the whole
         *  set while any single save is in flight stops a fast second edit
         *  from computing off a lead snapshot that doesn't have the first
         *  edit's change yet (see EditableField's own disabled comment). */}
        <fieldset disabled={updateLead.isPending} className="contents">
          <InfoCell label="Situation" value={lead.motivation ?? ''} onSave={(v) => saveField({ motivation: v.trim() || null })} />
          <InfoCell
            label="Timeline"
            value={lead.scriptAnswers?.timeline ?? ''}
            onSave={(v) => saveScriptAnswer('timeline', v.trim())}
          />
          <InfoCell
            label="Temperature"
            type="select"
            options={TEMPERATURE_OPTIONS}
            value={String(lead.rating ?? 0)}
            display={TEMPERATURE_LABEL[lead.rating] ?? 'Cold'}
            onSave={(v) => saveField({ rating: Number(v) })}
          />
          <InfoCell
            label="Asking"
            value={lead.askingPrice?.toString() ?? ''}
            display={lead.askingPrice != null ? formatCurrency(lead.askingPrice) : ''}
            filter={currencyDigitsOnly}
            onSave={(v) => saveField({ askingPrice: v ? Number(v) : null })}
          />
          <InfoCell
            label="Occupancy"
            type="select"
            options={OCCUPANCY_OPTIONS}
            value={lead.occupancy ?? ''}
            display={lead.occupancy ? OCCUPANCY_LABEL[lead.occupancy] : ''}
            onSave={(v) => saveField({ occupancy: (v || null) as Lead['occupancy'] })}
          />
          <InfoCell label="Source" value={lead.source ?? ''} onSave={(v) => saveField({ source: v.trim() || null })} />
          <InfoCell
            label="Owner"
            value={lead.scriptAnswers?.confirmation_owner ?? ''}
            onSave={(v) => saveScriptAnswer('confirmation_owner', v.trim())}
          />
          <InfoCell label="Solution" value={lead.solution ?? ''} onSave={(v) => saveField({ solution: v.trim() || null })} />
          <InfoCell label="Next Step" value={lead.nextStep ?? ''} onSave={(v) => saveField({ nextStep: v.trim() || null })} />
        </fieldset>
      </div>
    </div>
  );
}

/** lead.lotSize is free text from CSV import — usually a bare number like
 * "3200.0" (sqft, no unit) rather than something already meant for display.
 * Trims a trailing ".0" and adds "sqft" for that common case; anything else
 * (e.g. "0.25 acres") is already self-describing and passes through as-is. */
function formatLotSize(raw: string): string {
  const trimmed = raw.trim();
  return /^\d+(\.0+)?$/.test(trimmed) ? `${Math.round(parseFloat(trimmed)).toLocaleString()} sqft` : trimmed;
}

function PropertySummaryCard({ lead, onJumpToProperty }: { lead: Lead; onJumpToProperty: () => void }) {
  const images = useMemo(() => (lead.files ?? []).filter((f) => isImageFile(f.fileType, f.fileName)), [lead.files]);
  const hero = images[0];
  const { data: urls = {} } = useSignedFileUrls(hero ? [hero.storagePath] : []);
  const heroUrl = hero ? urls[hero.storagePath] : undefined;

  const specs: Array<{ label: string; value: string; danger?: boolean }> = [
    { label: 'Beds', value: lead.beds != null ? String(lead.beds) : '—' },
    { label: 'Baths', value: lead.baths != null ? String(lead.baths) : '—' },
    { label: 'Living area', value: lead.sqft != null ? `${lead.sqft.toLocaleString()} sqft` : '—' },
    { label: 'Lot size', value: lead.lotSize ? formatLotSize(lead.lotSize) : '—' },
    { label: 'Year built', value: lead.yearBuilt ? String(lead.yearBuilt) : '—' },
    { label: 'As-is value', value: lead.asIs != null ? formatCurrency(lead.asIs) : '—' },
    { label: 'Repairs', value: lead.estRepairs != null ? formatCurrency(lead.estRepairs) : '—' },
    { label: 'Auction', value: lead.auctionDate ? formatDate(lead.auctionDate) : '—', danger: !!lead.auctionDate },
  ];

  return (
    <button type="button" onClick={onJumpToProperty} className="card flex flex-wrap items-stretch gap-4 overflow-hidden !p-3.5 text-left">
      <div className="relative h-[190px] w-full shrink-0 overflow-hidden rounded-lg bg-surface-3 sm:w-60">
        {heroUrl ? (
          <img src={heroUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[12px] text-text-3">No photos yet</div>
        )}
        {images.length > 0 && (
          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-bg/80 px-2 py-0.5 text-[11px] font-medium text-text">
            <Images size={11} /> {images.length} photo{images.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-[16px] font-semibold text-text">{lead.address || 'No address on file'}</div>
          {lead.propType && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11.5px] font-medium text-primary">{lead.propType}</span>
          )}
        </div>
        {lead.condition && (
          <div className="mt-1 text-[12.5px] text-text-3">
            Condition: <span className="font-medium text-text-2">{lead.condition}</span>
          </div>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2 min-[420px]:grid-cols-4">
          {specs.map((s) => (
            <div key={s.label} className={`rounded-md px-2.5 py-2 ${s.danger ? 'bg-danger-dim' : 'bg-surface-3'}`}>
              <div className={`text-[10.5px] font-semibold uppercase tracking-wide ${s.danger ? 'text-danger/80' : 'text-text-3'}`}>{s.label}</div>
              <div className={`mt-0.5 font-mono text-[13.5px] font-semibold ${s.danger ? 'text-danger' : 'text-text'}`}>{s.value}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 text-[12.5px] font-medium text-primary">Full property details ›</div>
      </div>
    </button>
  );
}

/** A compact preview of the same notes thread the Activity tab's own Notes
 *  section owns (lead_activities, type 'note') — not a second, separate
 *  notes field. Shows the latest note and lets you add one right here;
 *  "View all" jumps to Activity for the full back-and-forth. */
function NotesCard({ lead, onJumpToActivity }: { lead: Lead; onJumpToActivity: () => void }) {
  const { data: activities = [] } = useActivities(lead.id);
  const addActivity = useAddActivity();
  const [body, setBody] = useState('');

  const notes = useMemo(() => activities.filter((a) => a.type === 'note'), [activities]);
  const latest = notes[notes.length - 1];

  function handleSend() {
    if (!body.trim()) return;
    addActivity.mutate({ leadId: lead.id, type: 'note', body: body.trim() }, { onSuccess: () => setBody('') });
  }

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex items-start gap-2.5">
          <NotebookText size={16} className="mt-0.5 shrink-0 text-text-3" />
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Notes</div>
        </div>
        {notes.length > 0 && (
          <button className="text-[11px] font-medium text-primary hover:underline" onClick={onJumpToActivity}>
            View all ({notes.length})
          </button>
        )}
      </div>

      {lead.aiScoreReasoning && (
        <div className="mt-2 ml-[26px] rounded-lg border border-border-2 bg-surface-3 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-text-3">
            <Archive size={11} /> Legacy note
          </div>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-text-2">{lead.aiScoreReasoning}</p>
        </div>
      )}

      {latest ? (
        <div className="mt-2 pl-[26px]">
          <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-text-2">{latest.body}</p>
          <div className="mt-1 text-[11px] text-text-3">
            {latest.authorName} · {formatDateTime(latest.createdAt)}
          </div>
        </div>
      ) : (
        !lead.aiScoreReasoning && <p className="mt-2 pl-[26px] text-[13px] text-text-3">No notes yet.</p>
      )}

      <div className="mt-3 flex items-end gap-2 rounded-lg border border-border-2 bg-surface-3 p-2 focus-within:border-primary/50">
        <textarea
          className="max-h-24 flex-1 resize-none bg-transparent px-1 py-1 text-[13px] text-text outline-none placeholder:text-text-3"
          rows={1}
          placeholder="Add a note…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <button
          className="btn btn-primary shrink-0 !p-2"
          title="Send (Enter)"
          onClick={handleSend}
          disabled={addActivity.isPending || !body.trim()}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}

export function OverviewTab({
  lead,
  onJumpToProperty,
  onJumpToActivity,
}: {
  lead: Lead;
  onJumpToProperty: () => void;
  onJumpToActivity: () => void;
}) {
  const updateLead = useUpdateLead();
  function saveField(patch: Partial<Lead>) {
    updateLead.mutate({ id: lead.id, ...patch });
  }

  const owed = lead.mortgageBalance;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {/* One mutation shared by every stat box below — disabling the
         *  whole row while any single save is in flight stops a fast
         *  second edit from computing off a lead snapshot that doesn't
         *  have the first edit's change yet (see EditableField's own
         *  disabled comment). */}
        <fieldset disabled={updateLead.isPending} className="contents">
          <div className="card !p-3.5">
            <EditableField
              variant="stat"
              label="ARV"
              value={lead.arv?.toString() ?? ''}
              display={formatCurrency(lead.arv)}
              filter={currencyDigitsOnly}
              onSave={(v) => saveField({ arv: v ? Number(v) : null })}
            />
          </div>
          <div className="card !p-3.5">
            <EditableField
              variant="stat"
              label="CMV"
              value={lead.asIs?.toString() ?? ''}
              display={formatCurrency(lead.asIs)}
              filter={currencyDigitsOnly}
              onSave={(v) => saveField({ asIs: v ? Number(v) : null })}
            />
          </div>
          <div className="card !p-3.5">
            <EditableField
              variant="stat"
              label="Owed"
              value={owed?.toString() ?? ''}
              display={owed == null || owed === 0 ? 'Paid off' : formatCurrency(owed)}
              filter={currencyDigitsOnly}
              onSave={(v) => saveField({ mortgageBalance: v ? Number(v) : null })}
            />
          </div>
          <div className="card !p-3.5">
            {/* The wholesale assignment fee — what this deal is actually
             *  worth once it closes. Same field the Dashboard's Revenue
             *  chart already reads (Expected = this fee across every lead
             *  Under Contract/In Title, Actual = once Closed), so setting
             *  it here is the only wiring that chart needed. */}
            <EditableField
              variant="stat"
              label="Wholesale Fee"
              value={lead.assignmentFee?.toString() ?? ''}
              display={lead.assignmentFee != null ? formatCurrency(lead.assignmentFee) : '—'}
              filter={currencyDigitsOnly}
              color="#10b981"
              onSave={(v) => saveField({ assignmentFee: v ? Number(v) : null })}
            />
          </div>
          <div className="card !p-3.5">
            <EditableField
              variant="stat"
              label="Max Offer"
              value={lead.maxOffer?.toString() ?? ''}
              display={lead.maxOffer != null ? formatCurrency(lead.maxOffer) : '—'}
              filter={currencyDigitsOnly}
              onSave={(v) => saveField({ maxOffer: v ? Number(v) : null })}
            />
          </div>
        </fieldset>
      </div>

      <DealStandsCard lead={lead} />
      <PropertySummaryCard lead={lead} onJumpToProperty={onJumpToProperty} />
      <LeadInformationCard lead={lead} />

      <NotesCard lead={lead} onJumpToActivity={onJumpToActivity} />
    </div>
  );
}
