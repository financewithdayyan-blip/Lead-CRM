import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Archive, ChevronDown, Hash, MessageSquareText, Pencil, Plus, Send, Trash2, Upload, ExternalLink, Share2, ArrowRightLeft, Sparkles, RefreshCw, PhoneCall, Loader2, CheckCircle2, Circle, User, Video } from 'lucide-react';
import { CardHeader } from '@/components/ui/CardHeader';
import { RadialGauge } from '@/components/ui/RadialGauge';
import { useAuth } from '@/contexts/AuthContext';
import { useLead, useUpdateLead, useSetLeadTags, useOverrideFollowupEarlyExit } from '@/hooks/useLeads';
import { useTags, useCreateTag, nextTagColor } from '@/hooks/useTags';
import { useActivities, useAddActivity, useDeleteActivity, useUpdateActivity } from '@/hooks/useActivities';
import { useTasks, useCreateTask, useToggleTask, useDeleteTask } from '@/hooks/useTasks';
import { useUploadLeadFile, useDeleteLeadFile, useSignedFileUrl, useSignedFileUrls } from '@/hooks/useLeadFiles';
import { useMyPendingShareForLead, useShareLead, useAdminShareLeadToCaller, useTransferLeadToAdmin } from '@/hooks/useLeadShares';
import { useTeamMembers } from '@/hooks/useTeam';
import { useScoreLead } from '@/hooks/useScoreLead';
import { StageBadge } from '@/components/ui/StageBadge';
import { TagPill } from '@/components/ui/TagPill';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { STAGE_CONFIG, visibleStagesFor, type ActivityType, type Lead, type LeadActivity, type LeadStage, type Tag } from '@/types/domain';
import { daysUntil, formatPhone, formatDate, formatDateTime, isImageFile, isVideoFile, localIsoDate } from '@/lib/utils';
import { formatPakistanTime, formatTimeInZone, resolveUsTimeZone } from '@/lib/timezone';
import { nextScheduledTouchDate, formatTouchDate, isFollowupOverdue, isTouchScheduledToday, isTouchedToday } from '@/lib/followupSchedule';
import { computeDaysToAuction, touchScheduleMode } from '@/lib/auctionTiers';
import { getScriptSteps, LIEN_TAG_NAMES } from '@/lib/callScript';
import { PacketTab } from '@/components/packets/PacketTab';
import { SmsThreadTab } from '@/components/sms/SmsThreadTab';
import { scoreColor } from '@/lib/aiScore';

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

function AdminShareToCallerButton({
  leadId,
  stage,
  currentOwnerId,
}: {
  leadId: string;
  stage: LeadStage;
  currentOwnerId: string;
}) {
  const { data: teamMembers = [] } = useTeamMembers();
  const { profile } = useAuth();
  const adminShare = useAdminShareLeadToCaller();
  const transferToAdmin = useTransferLeadToAdmin();
  const [open, setOpen] = useState(false);
  const [selectedCallerId, setSelectedCallerId] = useState('');

  const callers = teamMembers
    .map((m) => m.member)
    .filter((m) => m.role === 'caller' && m.id !== currentOwnerId);
  // Other admins on the team — admin_share_lead_to_caller has no server-side
  // role restriction on its target despite the name, so the same RPC covers
  // transferring to another admin. Excludes only the current owner, since
  // transferring to them is the no-op — NOT the viewer, who may well not
  // currently own this lead and is a perfectly valid target.
  const otherAdmins = teamMembers.map((m) => m.member).filter((m) => m.role === 'admin' && m.id !== currentOwnerId);
  // The founding admin's own account has no team_members row at all (nobody
  // "invited" them), so it can never appear in otherAdmins regardless of
  // filtering — offered explicitly instead, whenever the viewer isn't
  // already the current owner.
  const canTransferToSelf = !!profile?.id && profile.id !== currentOwnerId;

  function handleShare() {
    if (!selectedCallerId) return;
    if (selectedCallerId === '__self__') {
      transferToAdmin.mutate(leadId, {
        onSuccess: () => {
          setOpen(false);
          setSelectedCallerId('');
        },
      });
      return;
    }
    adminShare.mutate(
      { leadId, toUserId: selectedCallerId },
      {
        onSuccess: () => {
          setOpen(false);
          setSelectedCallerId('');
        },
      },
    );
  }

  return (
    <>
      <button className="btn !py-1.5 text-[12px]" onClick={() => setOpen(true)}>
        <ArrowRightLeft size={13} /> Transfer Lead
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setOpen(false)}>
          <div className="card w-full max-w-sm space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold text-text">Transfer this lead</div>
            <select
              className="input text-[13px]"
              value={selectedCallerId}
              onChange={(e) => setSelectedCallerId(e.target.value)}
            >
              <option value="">Select a team member…</option>
              {canTransferToSelf && <option value="__self__">Myself</option>}
              {otherAdmins.length > 0 && (
                <optgroup label="Admins">
                  {otherAdmins.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.fullName || c.email}
                    </option>
                  ))}
                </optgroup>
              )}
              {callers.length > 0 && (
                <optgroup label="Callers">
                  {callers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.fullName || c.email}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {callers.length === 0 && otherAdmins.length === 0 && !canTransferToSelf && (
              <p className="text-[12px] text-text-3">No other team members to transfer to.</p>
            )}
            <p className="text-[12px] text-text-3">
              This lead will be transferred to the selected team member immediately.
            </p>
            {(adminShare.isError || transferToAdmin.isError) && (
              <p className="text-[12px] text-danger">Transfer failed. Please try again.</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                className="btn text-[12px]"
                onClick={() => {
                  setOpen(false);
                  setSelectedCallerId('');
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary text-[12px]"
                disabled={!selectedCallerId || adminShare.isPending || transferToAdmin.isPending}
                onClick={handleShare}
              >
                {adminShare.isPending || transferToAdmin.isPending ? 'Transferring…' : 'Transfer'}
              </button>
            </div>
          </div>
        </div>
      )}
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

// 'property' is deliberately not a tab any more — Property Details is now
// edited directly on Overview (see PropertyEditCard), so there's no second
// place left that needs its own tab. 'activity' isn't a tab either —
// notes have their own chat on Overview, call/stage-change logging happens
// automatically elsewhere, and the raw activity feed itself is a backend
// record now rather than a page anyone navigates to.
const TABS = ['overview', 'sms', 'tasks', 'files', 'packet'] as const;
type TabKey = (typeof TABS)[number];
const TAB_LABELS: Record<TabKey, string> = {
  overview: 'Overview',
  packet: 'Deal Packet',
  sms: 'SMS',
  tasks: 'Tasks',
  files: 'Files',
};

/** The old separate Framework tab only ever displayed these questions and
 * answers read-only (no edit inputs anywhere in it — answers come from the
 * call script / AI conversation, not typed in here), so folding it into
 * Overview as an expand-to-read accordion loses nothing: every step, every
 * question, every recorded answer is still here, just collapsed until
 * clicked instead of a permanently-open tab. */
function FrameworkSnapshotCard({ lead }: { lead: Lead }) {
  const { data: tags = [] } = useTags();
  const leadTagNames = lead.tagIds.map((tid) => tags.find((t) => t.id === tid)?.name).filter((n): n is string => !!n);
  const hasMortgageStep = leadTagNames.some((n) => LIEN_TAG_NAMES.includes(n));
  const steps = getScriptSteps(hasMortgageStep);
  const answers = lead.scriptAnswers ?? {};
  const stepComplete = (step: (typeof steps)[number]) => step.questions.every((q) => (answers[q.key] ?? '').trim().length > 0);
  const completedCount = steps.filter(stepComplete).length;
  const [openTitle, setOpenTitle] = useState<string | null>(null);

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3">
        <CardHeader icon={CheckCircle2} title="Qualification Framework" sub={`${completedCount} of ${steps.length} steps answered`} tone="success" />
        <RadialGauge pct={(completedCount / steps.length) * 100} color="#10b981" size={40} strokeWidth={5} centered />
      </div>
      <div className="mt-3 space-y-1">
        {steps.map((step) => {
          const complete = stepComplete(step);
          const open = openTitle === step.title;
          return (
            <div key={step.title} className="rounded-md">
              <button
                onClick={() => setOpenTitle(open ? null : step.title)}
                className="flex w-full items-center gap-2.5 rounded-md px-1 py-1.5 text-left hover:bg-surface-3"
              >
                {complete ? <CheckCircle2 size={15} className="shrink-0 text-success" /> : <Circle size={15} className="shrink-0 text-text-3" />}
                <span className={`flex-1 text-[12.5px] ${complete ? 'text-text' : 'text-text-3'}`}>{step.title}</span>
                <ChevronDown size={13} className={`shrink-0 text-text-3 transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>
              {open && (
                <div className="ml-[23px] space-y-2.5 border-l border-border-2 py-2 pl-3">
                  {step.questions.map((q) => (
                    <div key={q.key}>
                      <p className="text-[11.5px] text-text-3">{q.prompt}</p>
                      <p className={`mt-0.5 text-[12.5px] ${answers[q.key] ? 'text-text' : 'italic text-text-3'}`}>
                        {answers[q.key] || 'No answer recorded'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Lead #, created date — the safe, always-accurate subset of "at a glance"
 * facts; nothing here is inferred or guessed. */
function QuickFactsCard({ lead }: { lead: Lead }) {
  const rows: Array<[string, string]> = [
    ['Lead #', lead.leadNum != null ? `#${lead.leadNum}` : '—'],
    ['Created', formatDate(lead.createdAt)],
  ];
  return (
    <div className="card">
      <CardHeader icon={Hash} title="Quick Facts" />
      <div className="mt-3 space-y-2.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between">
            <div className="text-[12px] text-text-3">{label}</div>
            <div className="text-[12.5px] font-medium text-text">{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Property Details, fully editable right on Overview — this replaced the
 * separate "Property Details" tab entirely (moved here verbatim, same
 * fields, same save/comps behavior) rather than duplicating a read-only
 * summary next to the real editable form on another tab. */
/** Pricing (ARV, offers, comps, etc.) deliberately lives only in Deal Packet
 * now — it already has its own ARV/comps workflow (with an "Import from
 * lead" pull of whatever's in lead_comps) for building investor-facing
 * packets, and duplicating a second editable pricing form here was the
 * redundant one. This card only owns the physical property facts. */
function PropertyEditCard({ lead }: { lead: Lead }) {
  const updateLead = useUpdateLead();
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
  });
  const [repairs, setRepairs] = useState(lead.repairs ?? {});
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
        repairs,
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
      <CardHeader icon={Archive} title="Property Details" sub="edit and save directly here" />
      <div className="mt-4 grid grid-cols-3 gap-3">
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

      <div className="mt-4 flex items-center gap-3">
        <button className="btn btn-primary" onClick={handleSave} disabled={updateLead.isPending}>
          Save property details
        </button>
        {saved && <span className="text-[12px] text-success">✓ Saved</span>}
      </div>
    </div>
  );
}

export function LeadProfileView({ id, backTo, allowShare = false }: { id: string | undefined; backTo: string; allowShare?: boolean }) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const { data: lead, isLoading } = useLead(id);
  const { data: tags = [] } = useTags();
  const updateLead = useUpdateLead();
  const setLeadTags = useSetLeadTags();
  const overrideEarlyExit = useOverrideFollowupEarlyExit();
  // Lets a link (e.g. the Kanban card's "Text" action) land straight on a
  // specific tab via `?tab=sms` instead of always opening on Overview. Read
  // once at mount — this page doesn't re-init the tab if the query string
  // changes underneath an already-open profile.
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const [tab, setTab] = useState<TabKey>(
    tabParam && (TABS as readonly string[]).includes(tabParam) ? (tabParam as TabKey) : 'overview',
  );
  const [pendingStage, setPendingStage] = useState<LeadStage | null>(null);

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
            {lead.scheduledCallbackAt && (() => {
              const sellerTimeZone = resolveUsTimeZone(lead.state, lead.address);
              const sellerTime = sellerTimeZone ? formatTimeInZone(lead.scheduledCallbackAt, sellerTimeZone) : null;
              return (
                <div
                  className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-info-dim px-2 py-1 text-[12px] font-medium text-info"
                  title={lead.scheduledCallbackNote ?? undefined}
                >
                  <PhoneCall size={12} />
                  Callback scheduled: {formatPakistanTime(lead.scheduledCallbackAt)} PKT
                  {sellerTime ? ` (seller's time: ${sellerTime})` : ''}
                  {lead.scheduledCallbackNote ? ` — "${lead.scheduledCallbackNote}"` : ''}
                </div>
              );
            })()}
          </div>
          <div className="flex flex-col items-end gap-2">
            <select
              className="input !w-auto !py-1.5 text-[12px]"
              value={lead.stage}
              onChange={(e) => {
                const newStage = e.target.value as LeadStage;
                const daysToAuction = computeDaysToAuction(lead.auctionDate);
                const schedMode = touchScheduleMode(daysToAuction);
                if (
                  lead.stage === 'followup' &&
                  newStage === 'dead_declined' &&
                  lead.touchCount < 10 &&
                  !lead.earlyExitOverride &&
                  schedMode !== 'deadline'
                ) {
                  setPendingStage(newStage);
                  return;
                }
                updateLead.mutate({ id: lead.id, stage: newStage });
              }}
            >
              {(() => {
                const stages = visibleStagesFor(isAdmin);
                // Always include the lead's current stage even if it'd
                // otherwise be filtered out for this viewer (e.g. an admin
                // looking at a lead a caller left in Voicemail) — dropping
                // it would leave the select showing nothing selected.
                if (!stages.includes(lead.stage)) stages.push(lead.stage);
                return stages.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_CONFIG[s].label}
                  </option>
                ));
              })()}
            </select>
            {/* Touch-lock warning + admin override */}
            {pendingStage === 'dead_declined' && lead.stage === 'followup' && (
              <div className="w-64 rounded-lg border border-amber-700/60 bg-amber-950/30 p-3 text-[12px]">
                <div className="font-semibold text-amber-300">
                  {lead.touchCount} of 10 touches completed — lead can't be closed yet.
                </div>
                <div className="mt-1 text-amber-500/80">
                  Complete the 10-touch schedule before moving to Dead / Declined.
                </div>
                <div className="mt-2 flex gap-2">
                  {isAdmin && (
                    <button
                      onClick={() =>
                        overrideEarlyExit.mutate(lead.id, {
                          onSuccess: () => {
                            updateLead.mutate({ id: lead.id, stage: 'dead_declined' });
                            setPendingStage(null);
                          },
                        })
                      }
                      disabled={overrideEarlyExit.isPending}
                      className="flex-1 rounded-md bg-amber-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
                    >
                      {overrideEarlyExit.isPending ? 'Applying…' : 'Admin Override'}
                    </button>
                  )}
                  <button
                    onClick={() => setPendingStage(null)}
                    className="rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {allowShare && <ShareLeadButton leadId={lead.id} stage={lead.stage} />}
            {isAdmin && (
              <AdminShareToCallerButton
                leadId={lead.id}
                stage={lead.stage}
                currentOwnerId={lead.userId}
              />
            )}
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

        {/* Touch progress panel for followup leads */}
        {lead.stage === 'followup' && lead.followupStartDate && (() => {
          const todayStr = localIsoDate(new Date());
          const nextDate = nextScheduledTouchDate(lead.followupStartDate, lead.touchCount, todayStr);
          const overdue = isFollowupOverdue(lead.followupStartDate, lead.touchCount, todayStr);
          const dueToday = isTouchScheduledToday(lead.followupStartDate, todayStr) && !isTouchedToday(lead.touchDates, todayStr) && lead.touchCount < 10;
          return (
            <div className={`mt-3 rounded-lg border p-3 ${overdue ? 'border-red-700/50 bg-red-950/20' : dueToday ? 'border-purple-700/40 bg-purple-950/15' : 'border-border bg-surface-2'}`}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className={`text-[11px] font-semibold uppercase tracking-wide ${overdue ? 'text-red-400' : dueToday ? 'text-purple-300' : 'text-text-3'}`}>
                    {overdue ? '⚠ Overdue — past schedule window' : dueToday ? `Touch ${lead.touchCount + 1} due today` : `Follow-Up Progress`}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="flex h-1.5 w-32 overflow-hidden rounded-full bg-border">
                      <div className="rounded-full bg-purple-500" style={{ width: `${(lead.touchCount / 10) * 100}%` }} />
                    </div>
                    <span className="text-[13px] font-semibold text-text">{lead.touchCount} / 10</span>
                  </div>
                  {nextDate && nextDate !== todayStr && (
                    <div className="mt-1 text-[11px] text-text-3">Next touch: <span className="text-text-2">{formatTouchDate(nextDate)}</span></div>
                  )}
                  {lead.touchCount >= 10 && (
                    <div className="mt-1 text-[11px] text-success">All 10 touches complete</div>
                  )}
                </div>
                {lead.earlyExitOverride && (
                  <span className="rounded-full border border-amber-700/50 bg-amber-950/30 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                    Admin override active
                  </span>
                )}
              </div>
            </div>
          );
        })()}

        <AiScoreCard lead={lead} />
      </div>

      <div className="mb-4 flex gap-1 border-b border-border">
        {TABS.filter((t) => t !== 'sms' || isAdmin).map((t) => (
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

      {tab === 'overview' && (
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_320px]">
          <div className="space-y-5">
            <OverviewTab lead={lead} leadId={lead.id} />
            <PropertyEditCard lead={lead} />
            <NotesChatSection leadId={lead.id} legacyNote={lead.notes ?? null} />
          </div>
          <div className="space-y-5">
            <QuickFactsCard lead={lead} />
            <FrameworkSnapshotCard lead={lead} />
          </div>
        </div>
      )}
      {tab === 'packet' && <PacketTab lead={lead} />}
      {/* SMS is an admin-only feature — texting leads isn't part of a
          caller's job, which is manual cold calling only. */}
      {tab === 'sms' && isAdmin && <SmsThreadTab lead={lead} />}
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

function OverviewTab({ lead, leadId }: { lead: Lead; leadId: string }) {
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
      <CardHeader icon={User} title="Contact Info" sub="how to reach this lead" />
      <div className="mt-4 grid grid-cols-2 gap-3">
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

function NotesChatSection({ leadId, legacyNote }: { leadId: string; legacyNote: string | null }) {
  const { profile } = useAuth();
  const { data: allActivities = [], isLoading } = useActivities(leadId);
  const addActivity = useAddActivity();
  const deleteActivity = useDeleteActivity();
  const updateActivity = useUpdateActivity();
  const [body, setBody] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const notes = allActivities.filter((a) => a.type === 'note');

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [notes.length]);

  function handleSend() {
    if (!body.trim()) return;
    addActivity.mutate({ leadId, type: 'note', body: body.trim() }, { onSuccess: () => setBody('') });
  }

  return (
    <div className="card">
      <CardHeader icon={MessageSquareText} title="Notes" sub={`${notes.length} logged`} />

      {/* Legacy note (old single-field notes migrated from lead.notes) — its
          own labeled block rather than an inline badge crammed into a
          paragraph, so it reads as an archived record, not just clutter. */}
      {legacyNote && (
        <div className="mt-3 rounded-lg border border-border-2 bg-surface-3 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-text-3">
            <Archive size={11} /> Legacy note
          </div>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-text-2">{legacyNote}</p>
        </div>
      )}

      {/* Chat bubbles */}
      {isLoading && <div className="mt-3 text-[13px] text-text-3">Loading…</div>}
      {!isLoading && notes.length === 0 && !legacyNote && (
        <div className="mt-4 flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-border-2 py-6 text-center">
          <MessageSquareText size={18} className="text-text-3" />
          <p className="text-[13px] text-text-3">No notes yet — add the first one below.</p>
        </div>
      )}
      {notes.length > 0 && (
        <div className="mt-3 max-h-80 space-y-3 overflow-y-auto rounded-lg border border-border-2 bg-surface-3/50 p-3 pr-2">
          {notes.map((a) => (
            <ActivityBubble
              key={a.id}
              a={a}
              isAdmin={profile?.role === 'admin'}
              leadId={leadId}
              onDelete={() => deleteActivity.mutate({ id: a.id, leadId })}
              onEdit={(body) => updateActivity.mutate({ id: a.id, leadId, body })}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Compose */}
      <div className="mt-3 flex items-end gap-2 rounded-lg border border-border-2 bg-surface p-2 focus-within:border-primary/50">
        <textarea
          className="max-h-32 flex-1 resize-none bg-transparent px-1 py-1 text-[13px] text-text outline-none placeholder:text-text-3"
          rows={1}
          placeholder="Add a note…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
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
      <div className="mt-1 text-[11px] text-text-3">Enter to send · Shift+Enter for new line</div>
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

function ActivityBubble({
  a,
  isAdmin,
  onDelete,
  onEdit,
  leadId,
}: {
  a: LeadActivity;
  isAdmin: boolean;
  onDelete: () => void;
  onEdit: (body: string) => void;
  leadId: string;
}) {
  const [editText, setEditText] = useState<string | null>(null);
  const isRight = a.authorRole === 'admin';
  const initials = a.authorName
    .split(' ')
    .map((w: string) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const canEdit = a.type !== 'stage_change';

  return (
    <div className={`group flex items-end gap-2 ${isRight ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
          isRight ? 'bg-primary/20 text-primary' : 'bg-surface-3 text-text-3'
        }`}
      >
        {initials}
      </div>

      {/* Bubble */}
      <div className={`relative max-w-[75%] ${isRight ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className={`mb-0.5 flex items-center gap-1.5 text-[10px] text-text-3 ${isRight ? 'flex-row-reverse' : ''}`}>
          <span className="font-medium">{a.authorName}</span>
          <span>·</span>
          <span>{formatDateTime(a.createdAt)}</span>
        </div>

        {editText !== null ? (
          <div className="flex w-full flex-col gap-1.5">
            <textarea
              autoFocus
              className="input resize-none text-[13px]"
              rows={3}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setEditText(null); }}
            />
            <div className="flex gap-1.5">
              <button
                className="btn btn-primary !px-2.5 !py-1 text-[12px]"
                disabled={!editText.trim()}
                onClick={() => { onEdit(editText.trim()); setEditText(null); }}
              >
                Save
              </button>
              <button className="btn !px-2.5 !py-1 text-[12px]" onClick={() => setEditText(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div
            className={`rounded-2xl px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap ${
              isRight
                ? 'rounded-br-sm border border-primary/25 bg-primary/8 text-text'
                : 'rounded-bl-sm border border-border-2 bg-surface-3 text-text'
            }`}
          >
            <span className={`mr-1.5 inline-block rounded px-1 py-0.5 text-[10px] font-semibold ${isRight ? 'bg-primary/15 text-primary' : 'bg-border-2 text-text-3'}`}>
              {ACTIVITY_LABEL[a.type]}
            </span>
            {a.body}
          </div>
        )}
      </div>

      {/* Actions — visible on hover, hidden while editing */}
      {editText === null && (
        <div className="mb-0.5 flex shrink-0 flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {canEdit && (
            <button
              className="text-text-3 hover:text-primary"
              onClick={() => setEditText(a.body)}
              title="Edit"
            >
              <Pencil size={12} />
            </button>
          )}
          <button
            className="text-text-3 hover:text-danger"
            onClick={onDelete}
            title="Delete"
          >
            <Trash2 size={12} />
          </button>
        </div>
      )}
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
  const [pasteHint, setPasteHint] = useState(false);

  const imageFiles = useMemo(() => files.filter((f) => isImageFile(f.fileType, f.fileName)), [files]);
  const videoFiles = useMemo(() => files.filter((f) => isVideoFile(f.fileType, f.fileName)), [files]);
  const otherFiles = useMemo(
    () => files.filter((f) => !isImageFile(f.fileType, f.fileName) && !isVideoFile(f.fileType, f.fileName)),
    [files],
  );
  const imagePaths = useMemo(() => imageFiles.map((f) => f.storagePath), [imageFiles]);
  const { data: imageUrls = {} } = useSignedFileUrls(imagePaths);

  async function handleView(storagePath: string) {
    const url = await signedUrl.mutateAsync(storagePath);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function uploadMany(fileList: FileList | File[]) {
    for (const file of Array.from(fileList)) {
      uploadFile.mutate({ leadId: lead.id, file });
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) uploadMany(e.target.files);
    // Reset so the same file(s) can be re-selected if needed
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // Ctrl+V anywhere on this tab uploads whatever image is on the clipboard —
  // a screenshot, or a photo copied out of another app — without having to
  // save it to disk first just to run it back through the file picker.
  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles = Array.from(items)
        .filter((item) => item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((f): f is File => !!f);
      if (imageFiles.length === 0) return;
      e.preventDefault();
      uploadMany(imageFiles);
      setPasteHint(true);
      setTimeout(() => setPasteHint(false), 1500);
    }
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [lead.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">Files & Photos</h3>
        <label className={`btn cursor-pointer ${uploadFile.isPending ? 'pointer-events-none opacity-60' : ''}`}>
          <Upload size={14} /> {uploadFile.isPending ? 'Uploading…' : 'Upload'}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
            onChange={handleFileChange}
          />
        </label>
      </div>

      <p className="mb-3 text-[12px] text-text-3">
        {pasteHint ? 'Pasted — uploading…' : 'Tip: copy an image and press Ctrl+V anywhere on this tab to upload it directly.'}
      </p>

      {uploadFile.isError && (
        <div className="mb-3 rounded-md bg-danger-dim px-3 py-2 text-[12px] text-danger">
          Upload failed: {(uploadFile.error as Error)?.message ?? 'Unknown error'}
        </div>
      )}

      {files.length === 0 && !uploadFile.isPending && (
        <div className="text-[13px] text-text-3">No files uploaded yet.</div>
      )}

      {imageFiles.length > 0 && (
        <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
          {imageFiles.map((f) => {
            const url = imageUrls[f.storagePath];
            return (
              <div key={f.id} className="group relative aspect-square overflow-hidden rounded-md border border-border-2 bg-surface-3">
                {url ? (
                  <img
                    src={url}
                    alt={f.fileName}
                    title={f.fileName}
                    className="h-full w-full cursor-pointer object-cover"
                    onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-text-3">
                    <Loader2 size={16} className="animate-spin" />
                  </div>
                )}
                <button
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity hover:bg-danger group-hover:opacity-100"
                  onClick={() => deleteFile.mutate({ id: f.id, storagePath: f.storagePath, leadId: lead.id })}
                  title="Delete"
                >
                  <Trash2 size={12} />
                </button>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1 text-[10px] text-white">
                  {formatDateTime(f.createdAt)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {videoFiles.length > 0 && (
        <div className="mb-3 space-y-2">
          {videoFiles.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-3 rounded-md border border-border-2 bg-surface-3 p-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <Video size={15} className="shrink-0 text-text-3" />
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-text">{f.fileName}</div>
                  <div className="text-[11px] text-text-3">{formatDateTime(f.createdAt)}</div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button className="text-text-3 hover:text-primary" onClick={() => handleView(f.storagePath)} title="Play">
                  <ExternalLink size={14} />
                </button>
                <button className="text-text-3 hover:text-danger" onClick={() => deleteFile.mutate({ id: f.id, storagePath: f.storagePath, leadId: lead.id })} title="Delete">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {otherFiles.length > 0 && (
        <div className="space-y-2">
          {otherFiles.map((f) => (
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
      )}
    </div>
  );
}

export function LeadProfilePage() {
  const { id } = useParams<{ id: string }>();
  return <LeadProfileView id={id} backTo="/leads" allowShare />;
}
