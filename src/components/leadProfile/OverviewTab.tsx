import { useMemo, useState } from 'react';
import { Archive, NotebookText, Send } from 'lucide-react';
import { useUpdateLead } from '@/hooks/useLeads';
import { useSignedFileUrls } from '@/hooks/useLeadFiles';
import { useActivities, useAddActivity } from '@/hooks/useActivities';
import { EditableField } from '@/components/leadProfile/EditableField';
import { currencyDigitsOnly, formatCurrency, formatDateTime, formatPhone, isImageFile } from '@/lib/utils';
import type { Lead } from '@/types/domain';

const TEMPERATURE_LABEL = ['Cold', 'Warm', 'Hot'];
const TEMPERATURE_OPTIONS = [
  { value: '0', label: 'Cold' },
  { value: '1', label: 'Warm' },
  { value: '2', label: 'Hot' },
];

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
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3.5">
        {/* One mutation shared by every field below — disabling the whole
         *  set while any single save is in flight stops a fast second edit
         *  from computing off a lead snapshot that doesn't have the first
         *  edit's change yet (see EditableField's own disabled comment). */}
        <fieldset disabled={updateLead.isPending} className="contents">
          <EditableField
            label="Phone"
            value={lead.phone ?? ''}
            display={lead.phone ? formatPhone(lead.phone) : ''}
            onSave={(v) => saveField({ phone: formatPhone(v.trim()) })}
          />
          <EditableField label="Situation" value={lead.motivation ?? ''} onSave={(v) => saveField({ motivation: v.trim() || null })} />
          <EditableField
            label="Timeline"
            value={lead.scriptAnswers?.timeline ?? ''}
            onSave={(v) => saveScriptAnswer('timeline', v.trim())}
          />
          <EditableField label="Solution" value={lead.solution ?? ''} onSave={(v) => saveField({ solution: v.trim() || null })} />
          <EditableField label="Source" value={lead.source ?? ''} onSave={(v) => saveField({ source: v.trim() || null })} />
          <EditableField
            label="Owner"
            value={lead.scriptAnswers?.confirmation_owner ?? ''}
            onSave={(v) => saveScriptAnswer('confirmation_owner', v.trim())}
          />
          <EditableField
            label="Temperature"
            type="select"
            options={TEMPERATURE_OPTIONS}
            value={String(lead.rating ?? 0)}
            display={TEMPERATURE_LABEL[lead.rating] ?? 'Cold'}
            onSave={(v) => saveField({ rating: Number(v) })}
          />
          <EditableField label="Next Step" value={lead.nextStep ?? ''} onSave={(v) => saveField({ nextStep: v.trim() || null })} />
        </fieldset>
      </div>
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
  const equity = owed != null && lead.arv != null ? lead.arv - owed : null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {/* Est. Equity sits outside both fieldsets — it's ARV minus Owed,
         *  computed, not a stored column, so there's nothing to edit; it
         *  just updates on its own once either of those two changes. */}
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
        </fieldset>
        <StatBox label="Est. Equity" value={equity != null ? formatCurrency(equity) : '—'} color="#10b981" />
        <fieldset disabled={updateLead.isPending} className="contents">
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

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <LeadInformationCard lead={lead} />
        <PropertySummaryCard lead={lead} onJumpToProperty={onJumpToProperty} />
      </div>

      <NotesCard lead={lead} onJumpToActivity={onJumpToActivity} />
    </div>
  );
}
