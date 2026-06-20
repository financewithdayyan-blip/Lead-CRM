import { useEffect, useMemo, useState } from 'react';
import { Camera, Plus, Trash2, Upload } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { StarRating } from '@/components/ui/StarRating';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { TagPill } from '@/components/ui/TagPill';
import { ScoreBadge } from '@/components/ui/ScoreBadge';
import { useLead, useUpdateLead, useUpsertComps, useSetLeadTags } from '@/hooks/useLeads';
import { useTags } from '@/hooks/useTags';
import { useCallLog } from '@/hooks/useCallLog';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { OUTCOME_TRANSITIONS, STATUS_CONFIG, type LeadStatus, type RepairFlags } from '@/types/domain';
import { formatCurrency, formatDate, formatDateTime, formatPhone } from '@/lib/utils';
import { KCF_STEPS, substitutePromptVars } from '@/lib/kcfSteps';

type Tab = 'overview' | 'property' | 'script' | 'comps' | 'photos' | 'activity';

const REPAIR_KEYS: Array<{ key: keyof RepairFlags; label: string }> = [
  { key: 'cosmetics', label: 'Cosmetics' },
  { key: 'hvac', label: 'HVAC' },
  { key: 'plumbing', label: 'Plumbing' },
  { key: 'roof', label: 'Roof' },
  { key: 'foundation', label: 'Foundation' },
  { key: 'electrical', label: 'Electrical' },
];

export function LeadDetailModal({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const { data: lead } = useLead(leadId);
  const { data: tags = [] } = useTags();
  const { data: callLog = [] } = useCallLog();
  const updateLead = useUpdateLead();
  const setLeadTags = useSetLeadTags();
  const [tab, setTab] = useState<Tab>('overview');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (lead) setNote(lead.note ?? '');
  }, [lead?.id]);

  const leadCalls = useMemo(() => callLog.filter((c) => c.leadId === leadId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [callLog, leadId]);

  if (!lead) return null;

  function saveNote() {
    if (note !== lead!.note) updateLead.mutate({ id: lead!.id, note });
  }

  function toggleTag(tagId: string) {
    const next = lead!.tagIds.includes(tagId) ? lead!.tagIds.filter((t) => t !== tagId) : [...lead!.tagIds, tagId];
    setLeadTags.mutate({ leadId: lead!.id, tagIds: next });
  }

  function setStatus(status: LeadStatus) {
    updateLead.mutate({ id: lead!.id, status });
  }

  return (
    <Modal open onClose={onClose} width="xl">
      <div className="-mx-5 -mt-5 mb-4 border-b border-border bg-surface-3 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-xl font-semibold text-text">
                {lead.firstName} {lead.lastName}
              </h2>
              <StatusBadge status={lead.status} />
              <ScoreBadge lead={lead} callLog={callLog} />
            </div>
            <div className="mt-1 text-sm text-text-2">
              {formatPhone(lead.phone)} {lead.phone2 && `· ${formatPhone(lead.phone2)}`} {lead.address && `· ${lead.address}`}
            </div>
          </div>
          <StarRating value={lead.rating} onChange={(v) => updateLead.mutate({ id: lead.id, rating: v })} size={18} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {tags.map((t) => (
            <button key={t.id} onClick={() => toggleTag(t.id)}>
              <span
                className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-opacity"
                style={{
                  backgroundColor: lead.tagIds.includes(t.id) ? t.colorBg : 'transparent',
                  color: lead.tagIds.includes(t.id) ? t.colorText : '#6b7184',
                  border: lead.tagIds.includes(t.id) ? 'none' : '1px solid #343c52',
                }}
              >
                {t.name}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {(OUTCOME_TRANSITIONS[lead.status] ?? []).map((s) => (
            <button key={s} onClick={() => setStatus(s)} className="btn !px-2.5 !py-1 text-[12px]">
              → {STATUS_CONFIG[s].label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 flex gap-1 border-b border-border">
        {(['overview', 'property', 'script', 'comps', 'photos', 'activity'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-[13px] font-medium capitalize transition-colors ${
              tab === t ? 'border-b-2 border-blue text-blue-bright' : 'text-text-3 hover:text-text-2'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Email" value={lead.email ?? '—'} />
            <Field label="State" value={lead.state ?? '—'} />
            <Field label="Batch" value={lead.batch ?? '—'} />
            <Field label="Lead #" value={lead.leadNum?.toString() ?? '—'} />
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea className="input min-h-[120px]" value={note} onChange={(e) => setNote(e.target.value)} onBlur={saveNote} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Motivation" value={lead.motivation ?? '—'} />
            <Field label="Follow-up date" value={formatDate(lead.followupDate)} />
          </div>
        </div>
      )}

      {tab === 'property' && (
        <div className="space-y-5">
          <div className="grid grid-cols-4 gap-4">
            <NumField label="Beds" value={lead.beds} onSave={(v) => updateLead.mutate({ id: lead.id, beds: v })} />
            <NumField label="Baths" value={lead.baths} onSave={(v) => updateLead.mutate({ id: lead.id, baths: v })} />
            <NumField label="Sqft" value={lead.sqft} onSave={(v) => updateLead.mutate({ id: lead.id, sqft: v })} />
            <NumField label="Year Built" value={lead.yearBuilt} onSave={(v) => updateLead.mutate({ id: lead.id, yearBuilt: v })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <TextField label="Lot Size" value={lead.lotSize} onSave={(v) => updateLead.mutate({ id: lead.id, lotSize: v })} />
            <TextField label="Property Type" value={lead.propType} onSave={(v) => updateLead.mutate({ id: lead.id, propType: v })} />
          </div>
          <div>
            <label className="label">Condition rating (1–10)</label>
            <input
              type="number"
              min={1}
              max={10}
              className="input w-24"
              defaultValue={lead.propertyRating ?? ''}
              onBlur={(e) => updateLead.mutate({ id: lead.id, propertyRating: e.target.value ? Number(e.target.value) : null })}
            />
          </div>
          <div>
            <label className="label">Repair flags</label>
            <div className="flex flex-wrap gap-2">
              {REPAIR_KEYS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => updateLead.mutate({ id: lead.id, repairs: { ...lead.repairs, [key]: !lead.repairs[key] } })}
                  className={`btn !px-2.5 !py-1 text-[12px] ${lead.repairs[key] ? '!border-amber !bg-amber/10 !text-amber' : ''}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <NumField label="ARV" value={lead.arv} money onSave={(v) => updateLead.mutate({ id: lead.id, arv: v })} />
            <NumField label="As-Is Value" value={lead.asIs} money onSave={(v) => updateLead.mutate({ id: lead.id, asIs: v })} />
            <NumField label="Est. Repairs" value={lead.estRepairs} money onSave={(v) => updateLead.mutate({ id: lead.id, estRepairs: v })} />
          </div>
          <div className="grid grid-cols-4 gap-4">
            <NumField label="Min Offer" value={lead.minOffer} money onSave={(v) => updateLead.mutate({ id: lead.id, minOffer: v })} />
            <NumField label="Max Offer" value={lead.maxOffer} money onSave={(v) => updateLead.mutate({ id: lead.id, maxOffer: v })} />
            <NumField label="Asking Price" value={lead.askingPrice} money onSave={(v) => updateLead.mutate({ id: lead.id, askingPrice: v })} />
            <NumField label="Final Price" value={lead.finalPrice} money onSave={(v) => updateLead.mutate({ id: lead.id, finalPrice: v })} />
          </div>
        </div>
      )}

      {tab === 'script' && <KcfTab leadId={lead.id} sellerName={`${lead.firstName} ${lead.lastName}`.trim()} address={lead.address ?? ''} />}

      {tab === 'comps' && <CompsTab leadId={lead.id} comps={lead.comps ?? []} />}

      {tab === 'photos' && <PhotosTab leadId={lead.id} photoUrls={lead.photoUrls ?? []} />}

      {tab === 'activity' && (
        <div className="space-y-2">
          {leadCalls.length === 0 && <div className="text-sm text-text-3">No calls logged for this lead yet.</div>}
          {leadCalls.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-md border border-border bg-surface-3 px-3 py-2">
              <div className="flex items-center gap-2">
                <StatusBadge status={c.status} />
                {c.note && <span className="text-[13px] text-text-2">{c.note}</span>}
              </div>
              <span className="text-[12px] text-text-3">{formatDateTime(c.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="text-sm text-text">{value}</div>
    </div>
  );
}

function TextField({ label, value, onSave }: { label: string; value: string | null; onSave: (v: string | null) => void }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => onSave(v || null)} />
    </div>
  );
}

function NumField({ label, value, onSave, money }: { label: string; value: number | null; onSave: (v: number | null) => void; money?: boolean }) {
  const [v, setV] = useState(value?.toString() ?? '');
  useEffect(() => setV(value?.toString() ?? ''), [value]);
  return (
    <div>
      <label className="label">
        {label} {money && value != null && <span className="text-text-3">({formatCurrency(value)})</span>}
      </label>
      <input
        type="number"
        className="input"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => onSave(v === '' ? null : Number(v))}
      />
    </div>
  );
}

function KcfTab({ leadId, sellerName, address }: { leadId: string; sellerName: string; address: string }) {
  const { data: lead } = useLead(leadId);
  const updateLead = useUpdateLead();
  if (!lead) return null;
  const state = lead.kcfData;
  const total = KCF_STEPS.length;
  const done = KCF_STEPS.filter((s) => state.checks[s.id]).length;

  function setCheck(stepId: string, checked: boolean) {
    updateLead.mutate({ id: leadId, kcfData: { ...state, checks: { ...state.checks, [stepId]: checked } } });
  }
  function setField(key: string, value: string) {
    updateLead.mutate({ id: leadId, kcfData: { ...state, fields: { ...state.fields, [key]: value } } });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-4">
          <div className="h-full bg-blue transition-all" style={{ width: `${Math.round((done / total) * 100)}%` }} />
        </div>
        <span className="whitespace-nowrap text-[12px] text-text-3">
          {done} / {total}
        </span>
      </div>

      {KCF_STEPS.map((step) => (
        <div key={step.id} className="rounded-md border border-border bg-surface-3 p-3">
          <div className="flex items-start justify-between gap-3">
            <h4 className="text-sm font-semibold text-text">{step.title}</h4>
            <input type="checkbox" checked={!!state.checks[step.id]} onChange={(e) => setCheck(step.id, e.target.checked)} className="mt-1 h-4 w-4" />
          </div>
          <p
            className="mt-1 whitespace-pre-line text-[13px] italic text-text-2"
            dangerouslySetInnerHTML={{ __html: substitutePromptVars(step.prompt, sellerName || '[Seller Name]', address || '[Address]') }}
          />
          {step.questions.map((q) => (
            <div key={q.key} className="mt-2 text-[12px] text-text-3">
              {q.text}
            </div>
          ))}
          {step.fields.map((f) => (
            <div key={f.key} className="mt-2">
              <label className="label">{f.label}</label>
              {f.type === 'textarea' ? (
                <textarea
                  className="input min-h-[60px]"
                  placeholder={f.placeholder}
                  defaultValue={state.fields[f.key] ?? ''}
                  onBlur={(e) => setField(f.key, e.target.value)}
                />
              ) : (
                <input
                  className="input"
                  placeholder={f.placeholder}
                  defaultValue={state.fields[f.key] ?? ''}
                  onBlur={(e) => setField(f.key, e.target.value)}
                />
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function CompsTab({ leadId, comps }: { leadId: string; comps: NonNullable<ReturnType<typeof useLead>['data']>['comps'] }) {
  const upsertComps = useUpsertComps();
  const [rows, setRows] = useState(
    (comps ?? []).map((c) => ({ address: c.address ?? '', price: c.price?.toString() ?? '', sqft: c.sqft?.toString() ?? '', beds: c.beds?.toString() ?? '', baths: c.baths?.toString() ?? '', distance: c.distance ?? '', notes: c.notes ?? '' })),
  );

  function addRow() {
    setRows([...rows, { address: '', price: '', sqft: '', beds: '', baths: '', distance: '', notes: '' }]);
  }
  function removeRow(i: number) {
    setRows(rows.filter((_, idx) => idx !== i));
  }
  function save() {
    upsertComps.mutate({
      leadId,
      comps: rows
        .filter((r) => r.address.trim())
        .map((r) => ({
          address: r.address || null,
          price: r.price ? Number(r.price) : null,
          sqft: r.sqft ? Number(r.sqft) : null,
          beds: r.beds ? Number(r.beds) : null,
          baths: r.baths ? Number(r.baths) : null,
          distance: r.distance || null,
          notes: r.notes || null,
        })),
    });
  }

  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-7 gap-2 rounded-md border border-border bg-surface-3 p-2">
          <input className="input col-span-2" placeholder="Address" value={r.address} onChange={(e) => setRows(rows.map((row, idx) => (idx === i ? { ...row, address: e.target.value } : row)))} />
          <input className="input" placeholder="Price" value={r.price} onChange={(e) => setRows(rows.map((row, idx) => (idx === i ? { ...row, price: e.target.value } : row)))} />
          <input className="input" placeholder="Sqft" value={r.sqft} onChange={(e) => setRows(rows.map((row, idx) => (idx === i ? { ...row, sqft: e.target.value } : row)))} />
          <input className="input" placeholder="Beds/Baths" value={r.beds} onChange={(e) => setRows(rows.map((row, idx) => (idx === i ? { ...row, beds: e.target.value } : row)))} />
          <input className="input" placeholder="Distance" value={r.distance} onChange={(e) => setRows(rows.map((row, idx) => (idx === i ? { ...row, distance: e.target.value } : row)))} />
          <button onClick={() => removeRow(i)} className="btn !px-2 text-red">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <button onClick={addRow} className="btn">
          <Plus size={14} /> Add comp
        </button>
        <button onClick={save} className="btn btn-primary">
          Save comps
        </button>
      </div>
    </div>
  );
}

function PhotosTab({ leadId, photoUrls }: { leadId: string; photoUrls: string[] }) {
  const { session } = useAuth();
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    (async () => {
      const entries = await Promise.all(
        photoUrls.map(async (path) => {
          const { data } = await supabase.storage.from('lead-photos').createSignedUrl(path, 3600);
          return [path, data?.signedUrl ?? ''] as const;
        }),
      );
      setSignedUrls(Object.fromEntries(entries));
    })();
  }, [photoUrls.join(',')]);

  async function handleUpload(files: FileList | null) {
    if (!files || !session) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const path = `${session.user.id}/${leadId}/${Date.now()}-${file.name}`;
        const { error } = await supabase.storage.from('lead-photos').upload(path, file);
        if (error) throw error;
        await supabase.from('lead_photos').insert({ lead_id: leadId, storage_path: path });
      }
      window.location.reload();
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-3">
        {photoUrls.map((path) => (
          <div key={path} className="aspect-square overflow-hidden rounded-md border border-border bg-surface-3">
            {signedUrls[path] && <img src={signedUrls[path]} className="h-full w-full object-cover" />}
          </div>
        ))}
        <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border-2 text-text-3 hover:border-blue hover:text-blue">
          {uploading ? <Upload size={20} className="animate-pulse" /> : <Camera size={20} />}
          <span className="text-[11px]">Upload</span>
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleUpload(e.target.files)} />
        </label>
      </div>
    </div>
  );
}
