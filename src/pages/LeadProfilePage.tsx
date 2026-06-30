import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Upload, ExternalLink, Share2, Sparkles, RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLead, useUpdateLead, useSetLeadTags, useUpsertComps } from '@/hooks/useLeads';
import { useTags, useCreateTag, nextTagColor } from '@/hooks/useTags';
import { useActivities, useAddActivity, useDeleteActivity } from '@/hooks/useActivities';
import { useTasks, useCreateTask, useToggleTask, useDeleteTask } from '@/hooks/useTasks';
import { useUploadLeadFile, useDeleteLeadFile, useSignedFileUrl } from '@/hooks/useLeadFiles';
import { useScriptAnswers } from '@/hooks/useScriptAnswers';
import { useMyPendingShareForLead, useShareLead } from '@/hooks/useLeadShares';
import { useScoreLead } from '@/hooks/useScoreLead';
import { StageBadge } from '@/components/ui/StageBadge';
import { StarRating } from '@/components/ui/StarRating';
import { TagPill } from '@/components/ui/TagPill';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { STAGE_ORDER, STAGE_CONFIG, type ActivityType, type Comp, type Lead, type LeadStage, type Tag } from '@/types/domain';
import { callerDisplayName, formatPhone, formatDate, formatDateTime } from '@/lib/utils';
import { SCRIPT_STEPS } from '@/lib/callScript';

function scoreColor(score: number) {
  if (score >= 85) return { ring: 'ring-emerald-500', bg: 'bg-emerald-500', text: 'text-emerald-400', label: 'High' };
  if (score >= 65) return { ring: 'ring-blue-500', bg: 'bg-blue-500', text: 'text-blue-400', label: 'Good' };
  if (score >= 45) return { ring: 'ring-amber-500', bg: 'bg-amber-500', text: 'text-amber-400', label: 'Moderate' };
  if (score >= 25) return { ring: 'ring-orange-500', bg: 'bg-orange-500', text: 'text-orange-400', label: 'Low' };
  return { ring: 'ring-red-500', bg: 'bg-red-500', text: 'text-red-400', label: 'Dead' };
}

function AiScoreCard({ lead }: { lead: Lead }) {
  const scoreLead = useScoreLead();
  const [error, setError] = useState('');

  function handleScore() {
    setError('');
    scoreLead.mutate(lead.id, {
      onError: (err) => setError(err instanceof Error ? err.message : 'Scoring failed.'),
    });
  }

  const hasScore = lead.aiScore !== null;
  const colors = hasScore ? scoreColor(lead.aiScore!) : null;
  const scoredDate = lead.aiScoredAt ? new Date(lead.aiScoredAt).toLocaleDateString() : null;

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-start gap-4">
        {hasScore && colors ? (
          <>
            <div className="flex items-center gap-3">
              <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ring-2 ${colors.ring} bg-surface-2`}>
                <span className={`text-xl font-bold ${colors.text}`}>{lead.aiScore}</span>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-[13px] font-semibold text-text">
                  <Sparkles size={13} className={colors.text} />
                  AI Lead Score
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${colors.bg} text-white`}>{colors.label}</span>
                </div>
                {scoredDate && <div className="text-[11px] text-text-3">Scored {scoredDate}</div>}
              </div>
            </div>
            <p className="flex-1 text-[13px] leading-relaxed text-text-2">{lead.aiScoreReasoning}</p>
          </>
        ) : (
          <div className="flex items-center gap-2 text-[13px] text-text-3">
            <Sparkles size={14} className="text-primary" />
            <span>No AI score yet — click to analyze this lead.</span>
          </div>
        )}
        <button
          onClick={handleScore}
          disabled={scoreLead.isPending}
          className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-[12px] font-semibold text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {scoreLead.isPending ? (
            <><RefreshCw size={12} className="animate-spin" /> Scoring…</>
          ) : (
            <><Sparkles size={12} /> {hasScore ? 'Re-score' : 'Score with AI'}</>
          )}
        </button>
      </div>
      {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
    </div>
  );
}

function ShareLeadButton({ leadId, stage }: { leadId: string; stage: LeadStage }) {
  const { data: pendingShare } = useMyPendingShareForLead(leadId);
  const shareLead = useShareLead();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (pendingShare) {
    return <span className="text-[12px] font-medium text-warning">Pending admin approval</span>;
  }

  return (
    <>
      <button className="btn !py-1.5 text-[12px]" onClick={() => setConfirmOpen(true)}>
        <Share2 size={13} /> Share with Admin
      </button>
      <ConfirmDialog
        open={confirmOpen}
        title="Share this lead?"
        message={`Your admin will be notified and can accept or decline. If accepted, this lead (currently in ${STAGE_CONFIG[stage].label} stage) moves into their pipeline.`}
        confirmLabel="Share"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          shareLead.mutate({ leadId, stage });
          setConfirmOpen(false);
        }}
      />
    </>
  );
}

const ACTIVITY_LABEL: Record<ActivityType, string> = {
  note: 'Note',
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  sms: 'Text',
  stage_change: 'Stage changed',
};

const TABS = ['overview', 'property', 'script', 'activity', 'tasks', 'files'] as const;
type TabKey = (typeof TABS)[number];
const TAB_LABELS: Record<TabKey, string> = {
  overview: 'Overview',
  property: 'Property Details',
  script: 'Call Script',
  activity: 'Activity',
  tasks: 'Tasks',
  files: 'Files',
};

export function LeadProfileView({ id, backTo, allowShare = false }: { id: string | undefined; backTo: string; allowShare?: boolean }) {
  const navigate = useNavigate();
  const { data: lead, isLoading } = useLead(id);
  const { data: tags = [] } = useTags();
  const updateLead = useUpdateLead();
  const setLeadTags = useSetLeadTags();
  const [tab, setTab] = useState<TabKey>('overview');

  if (isLoading) return <div className="text-text-3">Loading…</div>;
  if (!lead) return <div className="text-text-3">Lead not found.</div>;

  return (
    <div>
      <button onClick={() => navigate(backTo)} className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-text-3 hover:text-text">
        <ArrowLeft size={14} /> Back to Leads
      </button>

      <div className="card mb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-semibold text-text">
                {lead.firstName} {lead.lastName}
              </h1>
              <StageBadge stage={lead.stage} />
              {lead.leadNum && <span className="text-[12px] text-text-3">#{lead.leadNum}</span>}
            </div>
            <div className="mt-1 text-sm text-text-2">
              {formatPhone(lead.phone)}
              {lead.phone2 ? ` · ${formatPhone(lead.phone2)}` : ''}
              {lead.email ? ` · ${lead.email}` : ''}
            </div>
            {lead.address && (
              <div className="mt-0.5 text-sm text-text-3">
                {lead.address}
                {lead.city ? `, ${lead.city}` : ''}
                {lead.state ? `, ${lead.state}` : ''} {lead.zip ?? ''}
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <StarRating value={lead.rating} onChange={(v) => updateLead.mutate({ id: lead.id, rating: v })} />
            <select
              className="input !w-auto !py-1.5 text-[12px]"
              value={lead.stage}
              onChange={(e) => updateLead.mutate({ id: lead.id, stage: e.target.value as LeadStage })}
            >
              {STAGE_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STAGE_CONFIG[s].label}
                </option>
              ))}
            </select>
            {allowShare && <ShareLeadButton leadId={lead.id} stage={lead.stage} />}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {lead.tagIds.map((tid) => {
            const tag = tags.find((t) => t.id === tid);
            return tag ? (
              <TagPill
                key={tid}
                tag={tag}
                onRemove={() => setLeadTags.mutate({ leadId: lead.id, tagIds: lead.tagIds.filter((x) => x !== tid) })}
              />
            ) : null;
          })}
          <TagPicker lead={lead} tags={tags} />
        </div>
        <AiScoreCard lead={lead} />
      </div>

      <div className="mb-4 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-[13px] font-medium transition-colors ${
              tab === t ? 'border-b-2 border-primary text-primary' : 'text-text-3 hover:text-text'
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab lead={lead} />}
      {tab === 'property' && <PropertyTab lead={lead} />}
      {tab === 'script' && <ScriptTab lead={lead} />}
      {tab === 'activity' && <ActivityTab leadId={lead.id} />}
      {tab === 'tasks' && <TasksTab leadId={lead.id} ownerId={lead.userId} />}
      {tab === 'files' && <FilesTab lead={lead} />}
    </div>
  );
}

function TagPicker({ lead, tags }: { lead: Lead; tags: Tag[] }) {
  const setLeadTags = useSetLeadTags();
  const createTag = useCreateTag();
  const available = tags.filter((t) => !lead.tagIds.includes(t.id));
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  if (adding) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          className="input !w-auto !py-1 text-[12px]"
          placeholder="New tag name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key !== 'Enter' || !newName.trim()) return;
            const c = nextTagColor(tags.length);
            const tag = await createTag.mutateAsync({ name: newName.trim(), colorBg: c.bg, colorText: c.text });
            setLeadTags.mutate({ leadId: lead.id, tagIds: [...lead.tagIds, tag.id] });
            setNewName('');
            setAdding(false);
          }}
        />
        <button className="text-[11px] text-text-3 hover:text-text" onClick={() => setAdding(false)}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      {available.length > 0 && (
        <select
          className="input !w-auto !py-1 text-[12px]"
          value=""
          onChange={(e) => {
            if (!e.target.value) return;
            setLeadTags.mutate({ leadId: lead.id, tagIds: [...lead.tagIds, e.target.value] });
          }}
        >
          <option value="">+ Add tag</option>
          {available.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      <button className="text-[11px] text-text-3 hover:text-primary" onClick={() => setAdding(true)}>
        + New tag
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function OverviewTab({ lead }: { lead: Lead }) {
  const updateLead = useUpdateLead();
  const [form, setForm] = useState({
    firstName: lead.firstName,
    lastName: lead.lastName,
    phone: formatPhone(lead.phone),
    phone2: lead.phone2 ? formatPhone(lead.phone2) : '',
    email: lead.email ?? '',
    address: lead.address ?? '',
    city: lead.city ?? '',
    state: lead.state ?? '',
    zip: lead.zip ?? '',
    source: lead.source ?? '',
    notes: lead.notes ?? '',
    nextFollowUp: lead.nextFollowUp ?? '',
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setForm({
      firstName: lead.firstName,
      lastName: lead.lastName,
      phone: lead.phone,
      phone2: lead.phone2 ?? '',
      email: lead.email ?? '',
      address: lead.address ?? '',
      city: lead.city ?? '',
      state: lead.state ?? '',
      zip: lead.zip ?? '',
      source: lead.source ?? '',
      notes: lead.notes ?? '',
      nextFollowUp: lead.nextFollowUp ?? '',
    });
  }, [lead.id]);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSave() {
    updateLead.mutate(
      {
        id: lead.id,
        firstName: form.firstName,
        lastName: form.lastName,
        phone: formatPhone(form.phone),
        phone2: form.phone2 ? formatPhone(form.phone2) : null,
        email: form.email || null,
        address: form.address || null,
        city: form.city || null,
        state: form.state || null,
        zip: form.zip || null,
        source: form.source || null,
        notes: form.notes || null,
        nextFollowUp: form.nextFollowUp || null,
      },
      { onSuccess: () => flash() },
    );
  }

  function flash() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="card">
      <div className="grid grid-cols-2 gap-3">
        <Field label="First Name">
          <input className="input" value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
        </Field>
        <Field label="Last Name">
          <input className="input" value={form.lastName} onChange={(e) => set('lastName', e.target.value)} />
        </Field>
        <Field label="Phone">
          <input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Phone 2">
          <input className="input" value={form.phone2} onChange={(e) => set('phone2', e.target.value)} />
        </Field>
        <Field label="Email">
          <input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Source">
          <input className="input" value={form.source} onChange={(e) => set('source', e.target.value)} />
        </Field>
        <div className="col-span-2">
          <Field label="Address">
            <input className="input" value={form.address} onChange={(e) => set('address', e.target.value)} />
          </Field>
        </div>
        <Field label="City">
          <input className="input" value={form.city} onChange={(e) => set('city', e.target.value)} />
        </Field>
        <Field label="State">
          <input className="input" value={form.state} onChange={(e) => set('state', e.target.value)} />
        </Field>
        <Field label="Zip">
          <input className="input" value={form.zip} onChange={(e) => set('zip', e.target.value)} />
        </Field>
        <Field label="Next Follow-Up">
          <input className="input" type="date" value={form.nextFollowUp} onChange={(e) => set('nextFollowUp', e.target.value)} />
        </Field>
        <div className="col-span-2">
          <Field label="Notes">
            <textarea className="input" rows={4} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button className="btn btn-primary" onClick={handleSave} disabled={updateLead.isPending}>
          Save changes
        </button>
        {saved && <span className="text-[12px] text-success">✓ Saved</span>}
      </div>
    </div>
  );
}

const REPAIR_FLAGS: Array<{ key: keyof Lead['repairs']; label: string }> = [
  { key: 'cosmetics', label: 'Cosmetics' },
  { key: 'hvac', label: 'HVAC' },
  { key: 'plumbing', label: 'Plumbing' },
  { key: 'roof', label: 'Roof' },
  { key: 'foundation', label: 'Foundation' },
  { key: 'electrical', label: 'Electrical' },
  { key: 'flooring', label: 'Flooring' },
];

function PropertyTab({ lead }: { lead: Lead }) {
  const updateLead = useUpdateLead();
  const upsertComps = useUpsertComps();
  const [form, setForm] = useState({
    propType: lead.propType ?? '',
    beds: lead.beds?.toString() ?? '',
    baths: lead.baths?.toString() ?? '',
    sqft: lead.sqft?.toString() ?? '',
    lotSize: lead.lotSize ?? '',
    yearBuilt: lead.yearBuilt?.toString() ?? '',
    auctionDate: lead.auctionDate ?? '',
    condition: lead.condition ?? '',
    motivation: lead.motivation ?? '',
    propertyRating: lead.propertyRating?.toString() ?? '',
    arv: lead.arv?.toString() ?? '',
    asIs: lead.asIs?.toString() ?? '',
    estRepairs: lead.estRepairs?.toString() ?? '',
    minOffer: lead.minOffer?.toString() ?? '',
    maxOffer: lead.maxOffer?.toString() ?? '',
    askingPrice: lead.askingPrice?.toString() ?? '',
    finalPrice: lead.finalPrice?.toString() ?? '',
  });
  const [repairs, setRepairs] = useState(lead.repairs ?? {});
  const [comps, setComps] = useState<Array<Partial<Comp>>>(lead.comps ?? []);
  const [saved, setSaved] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSave() {
    updateLead.mutate(
      {
        id: lead.id,
        propType: form.propType || null,
        beds: form.beds ? Number(form.beds) : null,
        baths: form.baths ? Number(form.baths) : null,
        sqft: form.sqft ? Number(form.sqft) : null,
        lotSize: form.lotSize || null,
        yearBuilt: form.yearBuilt ? Number(form.yearBuilt) : null,
        auctionDate: form.auctionDate || null,
        condition: form.condition || null,
        motivation: form.motivation || null,
        arv: form.arv ? Number(form.arv) : null,
        asIs: form.asIs ? Number(form.asIs) : null,
        propertyRating: form.propertyRating ? Number(form.propertyRating) : null,
        estRepairs: form.estRepairs ? Number(form.estRepairs) : null,
        minOffer: form.minOffer ? Number(form.minOffer) : null,
        maxOffer: form.maxOffer ? Number(form.maxOffer) : null,
        askingPrice: form.askingPrice ? Number(form.askingPrice) : null,
        finalPrice: form.finalPrice ? Number(form.finalPrice) : null,
        repairs,
      },
      { onSuccess: () => flash() },
    );
  }

  function flash() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function updateComp(i: number, key: keyof Comp, value: string) {
    setComps((prev) => prev.map((c, idx) => (idx === i ? { ...c, [key]: value } : c)));
  }
  function addComp() {
    setComps((prev) => [...prev, { address: '', price: null, sqft: null, beds: null, baths: null, distance: null, notes: null }]);
  }
  function removeComp(i: number) {
    setComps((prev) => prev.filter((_, idx) => idx !== i));
  }
  function saveComps() {
    upsertComps.mutate({
      leadId: lead.id,
      comps: comps.map((c) => ({
        address: c.address || null,
        price: c.price ? Number(c.price) : null,
        sqft: c.sqft ? Number(c.sqft) : null,
        beds: c.beds ? Number(c.beds) : null,
        baths: c.baths ? Number(c.baths) : null,
        distance: c.distance || null,
        notes: c.notes || null,
      })),
    });
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="mb-3 text-sm font-semibold text-text">Property</h3>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Property Type">
            <input className="input" value={form.propType} onChange={(e) => set('propType', e.target.value)} />
          </Field>
          <Field label="Beds">
            <input className="input" type="number" value={form.beds} onChange={(e) => set('beds', e.target.value)} />
          </Field>
          <Field label="Baths">
            <input className="input" type="number" value={form.baths} onChange={(e) => set('baths', e.target.value)} />
          </Field>
          <Field label="Sqft">
            <input className="input" type="number" value={form.sqft} onChange={(e) => set('sqft', e.target.value)} />
          </Field>
          <Field label="Lot Size">
            <input className="input" value={form.lotSize} onChange={(e) => set('lotSize', e.target.value)} />
          </Field>
          <Field label="Year Built">
            <input className="input" type="number" value={form.yearBuilt} onChange={(e) => set('yearBuilt', e.target.value)} />
          </Field>
          <Field label="Auction Date">
            <input className="input" type="date" value={form.auctionDate} onChange={(e) => set('auctionDate', e.target.value)} />
          </Field>
          <Field label="Condition">
            <input className="input" value={form.condition} onChange={(e) => set('condition', e.target.value)} />
          </Field>
          <Field label="Property Rating (1-10)">
            <select className="input" value={form.propertyRating} onChange={(e) => set('propertyRating', e.target.value)}>
              <option value="">—</option>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          <div className="col-span-2">
            <Field label="Motivation">
              <input className="input" value={form.motivation} onChange={(e) => set('motivation', e.target.value)} />
            </Field>
          </div>
        </div>

        <div className="mt-4">
          <div className="label">Repairs needed</div>
          <div className="flex flex-wrap gap-3">
            {REPAIR_FLAGS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-1.5 text-[13px] text-text-2">
                <input
                  type="checkbox"
                  checked={!!repairs[key]}
                  onChange={(e) => setRepairs((r) => ({ ...r, [key]: e.target.checked }))}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="mb-3 text-sm font-semibold text-text">Pricing</h3>
        <div className="grid grid-cols-3 gap-3">
          <Field label="ARV">
            <input className="input" type="number" value={form.arv} onChange={(e) => set('arv', e.target.value)} />
          </Field>
          <Field label="As-Is Value">
            <input className="input" type="number" value={form.asIs} onChange={(e) => set('asIs', e.target.value)} />
          </Field>
          <Field label="Est. Repairs">
            <input className="input" type="number" value={form.estRepairs} onChange={(e) => set('estRepairs', e.target.value)} />
          </Field>
          <Field label="Min Offer">
            <input className="input" type="number" value={form.minOffer} onChange={(e) => set('minOffer', e.target.value)} />
          </Field>
          <Field label="Max Offer">
            <input className="input" type="number" value={form.maxOffer} onChange={(e) => set('maxOffer', e.target.value)} />
          </Field>
          <Field label="Asking Price">
            <input className="input" type="number" value={form.askingPrice} onChange={(e) => set('askingPrice', e.target.value)} />
          </Field>
          <Field label="Final Price">
            <input className="input" type="number" value={form.finalPrice} onChange={(e) => set('finalPrice', e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button className="btn btn-primary" onClick={handleSave} disabled={updateLead.isPending}>
          Save property & pricing
        </button>
        {saved && <span className="text-[12px] text-success">✓ Saved</span>}
      </div>

      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text">Comps</h3>
          <button className="btn !px-2 !py-1 text-[12px]" onClick={addComp}>
            <Plus size={13} /> Add comp
          </button>
        </div>
        {comps.length === 0 && <div className="text-[13px] text-text-3">No comps added yet.</div>}
        <div className="space-y-2">
          {comps.map((c, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 rounded-md border border-border-2 bg-surface-3 p-2">
              <input
                className="input col-span-4 !py-1 text-[12px]"
                placeholder="Address"
                value={c.address ?? ''}
                onChange={(e) => updateComp(i, 'address', e.target.value)}
              />
              <input
                className="input col-span-2 !py-1 text-[12px]"
                placeholder="Price"
                type="number"
                value={c.price ?? ''}
                onChange={(e) => updateComp(i, 'price', e.target.value)}
              />
              <input
                className="input col-span-1 !py-1 text-[12px]"
                placeholder="Sqft"
                type="number"
                value={c.sqft ?? ''}
                onChange={(e) => updateComp(i, 'sqft', e.target.value)}
              />
              <input
                className="input col-span-1 !py-1 text-[12px]"
                placeholder="Beds"
                type="number"
                value={c.beds ?? ''}
                onChange={(e) => updateComp(i, 'beds', e.target.value)}
              />
              <input
                className="input col-span-1 !py-1 text-[12px]"
                placeholder="Baths"
                type="number"
                value={c.baths ?? ''}
                onChange={(e) => updateComp(i, 'baths', e.target.value)}
              />
              <input
                className="input col-span-2 !py-1 text-[12px]"
                placeholder="Distance"
                value={c.distance ?? ''}
                onChange={(e) => updateComp(i, 'distance', e.target.value)}
              />
              <button className="col-span-1 flex items-center justify-center text-text-3 hover:text-danger" onClick={() => removeComp(i)}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        {comps.length > 0 && (
          <button className="btn btn-primary mt-3" onClick={saveComps} disabled={upsertComps.isPending}>
            Save comps
          </button>
        )}
      </div>
    </div>
  );
}

function ScriptTab({ lead }: { lead: Lead }) {
  const { profile, session } = useAuth();
  const { answers, setAnswer, status } = useScriptAnswers(lead);
  const fullName = `${lead.firstName} ${lead.lastName}`.trim();
  const callerName = callerDisplayName(profile?.fullName, session?.user.email);
  const addressLine =
    [lead.address, lead.city, lead.state].filter(Boolean).join(', ') + (lead.zip ? ` ${lead.zip}` : '') || 'the property';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-text-3">Answers save automatically as you type.</p>
        <span className="text-[12px] font-medium">
          {status === 'saving' && <span className="text-text-3">Saving…</span>}
          {status === 'saved' && <span className="text-success">✓ Saved</span>}
        </span>
      </div>

      <div className="card">
        <h3 className="mb-3 text-sm font-semibold text-text">Introduction & Permission</h3>
        <div className="space-y-2 text-[13px] leading-relaxed text-text-2">
          <p className="rounded-md bg-surface-3 p-3">
            "Hi, is this <strong className="text-text">{fullName}</strong>? My name is <strong className="text-text">{callerName}</strong>.
            I'm calling about the property at <strong className="text-text">{addressLine}</strong>. Do you have a few minutes to talk about
            it?"
          </p>
          <p className="rounded-md bg-surface-3 p-3">
            "So we are basically an acquisition company — we help homeowners solve problems regarding their properties. We have access to
            public records and we came across your property there, that's how we got your address and number. We are interested in your
            house."
          </p>
          <p className="rounded-md bg-surface-3 p-3">› Are you interested in selling your house for the right price?</p>
        </div>
      </div>

      {SCRIPT_STEPS.map((step, i) => (
        <div key={step.key} className="card">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white">
              {i + 3}
            </span>
            <h3 className="text-sm font-semibold text-text">{step.title}</h3>
          </div>
          <p className="mb-2 text-[13px] text-text-2">{step.prompt}</p>
          {step.multiline ? (
            <textarea
              className="input"
              rows={3}
              value={answers[step.key] ?? ''}
              onChange={(e) => setAnswer(step.key, e.target.value)}
              placeholder="Type their answer…"
            />
          ) : (
            <input
              className="input"
              value={answers[step.key] ?? ''}
              onChange={(e) => setAnswer(step.key, e.target.value)}
              placeholder="Type their answer…"
            />
          )}
        </div>
      ))}
    </div>
  );
}

function ActivityTab({ leadId }: { leadId: string }) {
  const { data: activities = [], isLoading } = useActivities(leadId);
  const addActivity = useAddActivity();
  const deleteActivity = useDeleteActivity();
  const [type, setType] = useState<ActivityType>('call');
  const [body, setBody] = useState('');

  function handleAdd() {
    if (!body.trim()) return;
    addActivity.mutate({ leadId, type, body: body.trim() }, { onSuccess: () => setBody('') });
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="mb-3 text-sm font-semibold text-text">Log activity</h3>
        <div className="flex flex-wrap items-end gap-2">
          <select className="input !w-auto" value={type} onChange={(e) => setType(e.target.value as ActivityType)}>
            <option value="call">Call</option>
            <option value="note">Note</option>
            <option value="email">Email</option>
            <option value="meeting">Meeting</option>
            <option value="sms">Text</option>
          </select>
          <input
            className="input flex-1 min-w-[200px]"
            placeholder="What happened?"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <button className="btn btn-primary" onClick={handleAdd} disabled={addActivity.isPending}>
            <Plus size={14} /> Add
          </button>
        </div>
      </div>

      <div className="card">
        <h3 className="mb-3 text-sm font-semibold text-text">Timeline</h3>
        {isLoading && <div className="text-[13px] text-text-3">Loading…</div>}
        {!isLoading && activities.length === 0 && <div className="text-[13px] text-text-3">No activity logged yet.</div>}
        <div className="space-y-3">
          {activities.map((a) => (
            <div key={a.id} className="flex items-start justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
              <div>
                <div className="text-[13px] font-medium text-text">{ACTIVITY_LABEL[a.type]}</div>
                {a.body && <div className="mt-0.5 text-[13px] text-text-2">{a.body}</div>}
                <div className="mt-0.5 text-[11px] text-text-3">{formatDateTime(a.createdAt)}</div>
              </div>
              <button className="shrink-0 text-text-3 hover:text-danger" onClick={() => deleteActivity.mutate({ id: a.id, leadId })}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TasksTab({ leadId, ownerId }: { leadId: string; ownerId: string }) {
  const { data: allTasks = [] } = useTasks(ownerId);
  const tasks = allTasks.filter((t) => t.leadId === leadId);
  const createTask = useCreateTask();
  const toggleTask = useToggleTask();
  const deleteTask = useDeleteTask();
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');

  function handleAdd() {
    if (!title.trim()) return;
    createTask.mutate(
      { leadId, title: title.trim(), dueDate: dueDate || null, userId: ownerId },
      { onSuccess: () => { setTitle(''); setDueDate(''); } },
    );
  }

  return (
    <div className="card">
      <h3 className="mb-3 text-sm font-semibold text-text">Tasks</h3>
      <div className="flex flex-wrap items-end gap-2">
        <input
          className="input flex-1 min-w-[200px]"
          placeholder="New task…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <input className="input !w-auto" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        <button className="btn btn-primary" onClick={handleAdd} disabled={createTask.isPending}>
          <Plus size={14} /> Add
        </button>
      </div>

      <div className="mt-4 space-y-2">
        {tasks.length === 0 && <div className="text-[13px] text-text-3">No tasks for this lead.</div>}
        {tasks.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-3 rounded-md border border-border-2 bg-surface-3 p-2.5">
            <label className="flex flex-1 items-center gap-2.5">
              <input type="checkbox" checked={t.completed} onChange={(e) => toggleTask.mutate({ id: t.id, completed: e.target.checked })} />
              <span className={`text-[13px] ${t.completed ? 'text-text-3 line-through' : 'text-text'}`}>{t.title}</span>
            </label>
            <div className="flex items-center gap-2">
              {t.dueDate && <span className="text-[11px] text-text-3">{formatDate(t.dueDate)}</span>}
              <button className="text-text-3 hover:text-danger" onClick={() => deleteTask.mutate(t.id)}>
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FilesTab({ lead }: { lead: Lead }) {
  const uploadFile = useUploadLeadFile();
  const deleteFile = useDeleteLeadFile();
  const signedUrl = useSignedFileUrl();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const files = lead.files ?? [];

  async function handleView(storagePath: string) {
    const url = await signedUrl.mutateAsync(storagePath);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">Files & Photos</h3>
        <label className="btn cursor-pointer">
          <Upload size={14} /> Upload
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && uploadFile.mutate({ leadId: lead.id, file: e.target.files[0] })}
          />
        </label>
      </div>
      {files.length === 0 && <div className="text-[13px] text-text-3">No files uploaded yet.</div>}
      <div className="space-y-2">
        {files.map((f) => (
          <div key={f.id} className="flex items-center justify-between gap-3 rounded-md border border-border-2 bg-surface-3 p-2.5">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-text">{f.fileName}</div>
              <div className="text-[11px] text-text-3">{formatDateTime(f.createdAt)}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button className="text-text-3 hover:text-primary" onClick={() => handleView(f.storagePath)} title="View">
                <ExternalLink size={14} />
              </button>
              <button className="text-text-3 hover:text-danger" onClick={() => deleteFile.mutate({ id: f.id, storagePath: f.storagePath, leadId: lead.id })} title="Delete">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LeadProfilePage() {
  const { id } = useParams<{ id: string }>();
  return <LeadProfileView id={id} backTo="/leads" allowShare />;
}
