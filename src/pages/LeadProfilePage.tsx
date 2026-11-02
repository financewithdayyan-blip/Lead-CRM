import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRightLeft, Check, MessageSquareText, MoreHorizontal, Pencil, PhoneCall, Share2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLead, useUpdateLead, useSetLeadTags } from '@/hooks/useLeads';
import { useTags, useCreateTag, nextTagColor } from '@/hooks/useTags';
import { useAddActivity, useActivities } from '@/hooks/useActivities';
import { useMyPendingShareForLead, useShareLead, useAdminShareLeadToCaller, useTransferLeadToAdmin } from '@/hooks/useLeadShares';
import { useTeamMembers } from '@/hooks/useTeam';
import { useScoreLead } from '@/hooks/useScoreLead';
import { StageBadge } from '@/components/ui/StageBadge';
import { TagPill } from '@/components/ui/TagPill';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { STAGE_CONFIG, STAGE_ORDER, visibleStagesFor, type Lead, type LeadStage, type Tag } from '@/types/domain';
import { cn, formatPhone, initials, toE164 } from '@/lib/utils';
import { formatPakistanTime, formatTimeInZone, resolveUsTimeZone } from '@/lib/timezone';
import { scoreColor } from '@/lib/aiScore';
import { ContactSidebarCard } from '@/components/leadProfile/ContactSidebarCard';
import { TasksSidebarCard } from '@/components/leadProfile/TasksSidebarCard';
import { EventsSidebarCard } from '@/components/leadProfile/EventsSidebarCard';
import { OwnerSidebarCard } from '@/components/leadProfile/OwnerSidebarCard';
import { OverviewTab } from '@/components/leadProfile/OverviewTab';
import { PropertyTab } from '@/components/leadProfile/PropertyTab';
import { UnderwritingTab } from '@/components/leadProfile/UnderwritingTab';
import { DealTab } from '@/components/leadProfile/DealTab';
import { ActivityTab } from '@/components/leadProfile/ActivityTab';
import { EditContactModal } from '@/components/leadProfile/EditContactModal';
import { SmsThreadTab } from '@/components/sms/SmsThreadTab';

// Raw hex per scoreColor's own bands (85/65/45/25) — that util returns
// Tailwind class names (for the ring/text/bg classes elsewhere), but an SVG
// stroke attribute needs an actual color value, not a class.
function scoreHex(score: number): string {
  if (score >= 85) return '#10b981';
  if (score >= 65) return '#3b82f6';
  if (score >= 45) return '#f59e0b';
  if (score >= 25) return '#f97316';
  return '#ef4444';
}

/** A compact ring gauge + re-score control for the header's action row —
 *  real score/color/label from scoreColor, same as before, just drawn as a
 *  proportional arc instead of a flat ring-bordered circle. */
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
  const hex = hasScore ? scoreHex(lead.aiScore!) : '#5B6275';
  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const offset = hasScore ? circumference * (1 - lead.aiScore! / 100) : circumference;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2.5 rounded-md border border-border-2 bg-surface-3 py-1.5 pl-1.5 pr-3">
        <svg width="36" height="36" className="-rotate-90 shrink-0" aria-hidden="true">
          <circle cx="18" cy="18" r={radius} fill="none" stroke="#262C40" strokeWidth="4" />
          {hasScore && (
            <circle
              cx="18"
              cy="18"
              r={radius}
              fill="none"
              stroke={hex}
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
            />
          )}
        </svg>
        {hasScore && colors ? (
          <div className="text-[12.5px] leading-tight">
            <div>
              <b className="font-mono text-text">{lead.aiScore}</b> <span style={{ color: hex }} className="font-semibold">{colors.label}</span>
            </div>
            <button
              onClick={handleScore}
              disabled={scoreLead.isPending}
              className="text-[11px] font-medium text-text-3 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {scoreLead.isPending ? 'Scoring…' : 'Re-score'}
            </button>
          </div>
        ) : (
          <button
            onClick={handleScore}
            disabled={scoreLead.isPending}
            className="text-[12px] font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          >
            {scoreLead.isPending ? 'Scoring…' : 'Score with AI'}
          </button>
        )}
      </div>
      {error && <div className="text-[11px] text-danger">{error}</div>}
    </div>
  );
}

function ShareWithAdminDialog({
  leadId,
  stage,
  open,
  onClose,
}: {
  leadId: string;
  stage: LeadStage;
  open: boolean;
  onClose: () => void;
}) {
  const shareLead = useShareLead();
  return (
    <ConfirmDialog
      open={open}
      title="Share this lead?"
      message={`Your admin will be notified and can accept or decline. If accepted, this lead (currently in ${STAGE_CONFIG[stage].label} stage) moves into their pipeline.`}
      confirmLabel="Share"
      onCancel={onClose}
      onConfirm={() => {
        shareLead.mutate({ leadId, stage });
        onClose();
      }}
    />
  );
}

function TransferLeadModal({
  leadId,
  currentOwnerId,
  open,
  onClose,
}: {
  leadId: string;
  currentOwnerId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { data: teamMembers = [] } = useTeamMembers();
  const { profile } = useAuth();
  const adminShare = useAdminShareLeadToCaller();
  const transferToAdmin = useTransferLeadToAdmin();
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

  function handleClose() {
    setSelectedCallerId('');
    onClose();
  }

  function handleShare() {
    if (!selectedCallerId) return;
    if (selectedCallerId === '__self__') {
      transferToAdmin.mutate(leadId, { onSuccess: handleClose });
      return;
    }
    adminShare.mutate({ leadId, toUserId: selectedCallerId }, { onSuccess: handleClose });
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={handleClose}>
      <div className="card w-full max-w-sm space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="text-sm font-semibold text-text">Transfer this lead</div>
        <select className="input text-[13px]" value={selectedCallerId} onChange={(e) => setSelectedCallerId(e.target.value)}>
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
        <p className="text-[12px] text-text-3">This lead will be transferred to the selected team member immediately.</p>
        {(adminShare.isError || transferToAdmin.isError) && (
          <p className="text-[12px] text-danger">Transfer failed. Please try again.</p>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn text-[12px]" onClick={handleClose}>
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
  );
}

/** One icon button standing in for what used to be two separate buttons
 * ("Share with Admin", "Transfer Lead") — a caller sees "Share with Admin"
 * (asks their admin to approve taking this lead), an admin sees "Share with
 * Callers" (reassigns it immediately, no approval needed); an admin viewing
 * their own lead sees both, since this same page serves every role. */
function ShareMenu({
  leadId,
  stage,
  isAdmin,
  allowShare,
  currentOwnerId,
}: {
  leadId: string;
  stage: LeadStage;
  isAdmin: boolean;
  allowShare: boolean;
  currentOwnerId: string;
}) {
  const { data: pendingShare } = useMyPendingShareForLead(leadId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  const showShareWithAdmin = allowShare && !pendingShare;
  const showTransfer = isAdmin;
  if (!showShareWithAdmin && !showTransfer && !pendingShare) return null;

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setMenuOpen((o) => !o)}
        className="btn !px-2.5"
        title={pendingShare ? 'Pending admin approval' : 'More actions'}
      >
        <MoreHorizontal size={16} className={pendingShare ? 'text-warning' : undefined} />
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-lg border border-border-2 bg-surface shadow-lg">
          {pendingShare ? (
            <div className="px-3 py-2.5 text-[12px] font-medium text-warning">Pending admin approval</div>
          ) : (
            <>
              {showShareWithAdmin && (
                <button
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] text-text hover:bg-surface-2"
                  onClick={() => {
                    setMenuOpen(false);
                    setShareDialogOpen(true);
                  }}
                >
                  <Share2 size={13} /> Share with Admin
                </button>
              )}
              {showTransfer && (
                <button
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] text-text hover:bg-surface-2"
                  onClick={() => {
                    setMenuOpen(false);
                    setTransferOpen(true);
                  }}
                >
                  <ArrowRightLeft size={13} /> Share with Callers
                </button>
              )}
            </>
          )}
        </div>
      )}
      {showShareWithAdmin && (
        <ShareWithAdminDialog leadId={leadId} stage={stage} open={shareDialogOpen} onClose={() => setShareDialogOpen(false)} />
      )}
      {showTransfer && (
        <TransferLeadModal leadId={leadId} currentOwnerId={currentOwnerId} open={transferOpen} onClose={() => setTransferOpen(false)} />
      )}
    </div>
  );
}

// A stable (hashed from id, not random) color per lead for the header
// avatar — same approach used on the Leads table so avatars read
// consistently across the app.
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

// The real pipeline's main path (STAGE_ORDER minus the three off-path
// states — onhold/dead_declined/others never sit "between" two real
// stages, so a lead in one of those gets a plain badge instead of forced
// into this stepper). Post-contract stages are admin-only, same gate the
// stage <select> already uses via visibleStagesFor.
const MAIN_PATH_STAGES: LeadStage[] = STAGE_ORDER.filter((s) => s !== 'voicemail' && s !== 'onhold' && s !== 'dead_declined' && s !== 'others');
const OFF_PATH_STAGES: LeadStage[] = ['onhold', 'dead_declined', 'others'];

/** A real native <select>, styled to sit inline as the stepper's own
 * current-stage pill instead of a separate control next to it — picking
 * any option (including an off-path one like On Hold) changes the lead's
 * real stage. Replaces what used to be a second <select> floating beside
 * the stepper, which wrapped onto its own ugly row once the stepper (up to
 * 10 stages for an admin) wrapped first. */
function CurrentStagePill({ lead, onChange }: { lead: Lead; onChange: (stage: LeadStage) => void }) {
  const { profile } = useAuth();
  const stages = visibleStagesFor(profile?.role === 'admin');
  if (!stages.includes(lead.stage)) stages.push(lead.stage);
  return (
    <select
      aria-label="Change stage"
      value={lead.stage}
      onChange={(e) => onChange(e.target.value as LeadStage)}
      className="min-h-[32px] shrink-0 cursor-pointer appearance-none whitespace-nowrap rounded-full border-0 bg-primary pl-3 pr-6 text-[12.5px] font-semibold text-primary-text outline-none"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath d='M2 4l3 3 3-3' fill='none' stroke='white' stroke-width='1.6'/%3E%3C/svg%3E\")",
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 8px center',
      }}
    >
      {stages.map((s) => (
        <option key={s} value={s} className="bg-surface text-text">
          {STAGE_CONFIG[s].label}
        </option>
      ))}
    </select>
  );
}

/** Real stage progress, not the mockup's invented "Appointment" step — this
 * CRM's own STAGE_ORDER/STAGE_CONFIG, done/current/todo against the lead's
 * actual stage, with "day N" on the current step computed from this lead's
 * own stage_change activity log (the same timestamp the backend itself
 * records, not an estimate). The current step doubles as the real stage
 * picker (see CurrentStagePill) so there's no separate control to wrap
 * onto its own line once this row wraps. */
function StageStepper({
  lead,
  isAdmin,
  activities,
  onStageChange,
}: {
  lead: Lead;
  isAdmin: boolean;
  activities: Array<{ type: string; meta: Record<string, unknown>; createdAt: string }>;
  onStageChange: (stage: LeadStage) => void;
}) {
  const path = isAdmin ? MAIN_PATH_STAGES : MAIN_PATH_STAGES.filter((s) => !['inspection_walkthrough', 'in_title', 'closed'].includes(s));
  const isOffPath = OFF_PATH_STAGES.includes(lead.stage);
  const currentIdx = path.indexOf(lead.stage);

  const daysInStage = useMemo(() => {
    const changes = activities.filter((a) => a.type === 'stage_change');
    const entered = [...changes].reverse().find((a) => (a.meta as { to?: string })?.to === lead.stage)?.createdAt ?? lead.createdAt;
    return Math.max(0, Math.floor((Date.now() - new Date(entered).getTime()) / 86400000));
  }, [activities, lead.stage, lead.createdAt]);

  if (isOffPath) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-text-3">
        Currently <CurrentStagePill lead={lead} onChange={onStageChange} />
      </div>
    );
  }

  return (
    <ol aria-label="Deal stage" className="flex flex-wrap items-center gap-1.5">
      {path.map((s, i) => {
        const done = currentIdx >= 0 && i < currentIdx;
        const current = i === currentIdx;
        return (
          <li key={s} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden="true" className="h-px w-3.5 shrink-0 bg-border-2" />}
            {current ? (
              <CurrentStagePill lead={lead} onChange={onStageChange} />
            ) : (
              <span
                className={cn(
                  'flex min-h-[32px] items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[12.5px] font-semibold',
                  done ? 'border-transparent bg-surface-3 text-success' : 'border-border-2 text-text-3',
                )}
              >
                {done && <Check size={11} />}
                {STAGE_CONFIG[s].label}
              </span>
            )}
            {current && daysInStage > 0 && <span className="whitespace-nowrap text-[11px] text-text-3">day {daysInStage}</span>}
          </li>
        );
      })}
    </ol>
  );
}

const TABS = ['overview', 'sms', 'property', 'underwriting', 'deal', 'activity'] as const;
type TabKey = (typeof TABS)[number];
const TAB_LABELS: Record<TabKey, string> = {
  overview: 'Overview',
  sms: 'SMS',
  property: 'Property',
  underwriting: 'Underwriting',
  deal: 'Deal',
  activity: 'Activity',
};

export function LeadProfileView({ id, backTo, allowShare = false }: { id: string | undefined; backTo: string; allowShare?: boolean }) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const { data: lead, isLoading } = useLead(id);
  const { data: tags = [] } = useTags();
  const updateLead = useUpdateLead();
  const setLeadTags = useSetLeadTags();
  const addActivity = useAddActivity();
  const [editContactOpen, setEditContactOpen] = useState(false);
  // Zoom's own documented deep link, not a generic tel: link, so it launches
  // Zoom Phone specifically rather than whatever else the OS has registered
  // for tel: — same pattern as the Kanban card and Calendar quick actions.
  const handleCall = (phone: string | null | undefined) => {
    if (!lead) return;
    const e164 = toE164(phone ?? '');
    if (!e164) return;
    addActivity.mutate({ leadId: lead.id, type: 'call', body: 'Quick call logged from lead profile' });
    window.location.href = `zoomphonecall://${e164}`;
  };
  // Lets a link elsewhere (e.g. a Kanban card's "Text" action) land straight
  // on the SMS tab via `?openSms=1` instead of always opening on Overview.
  // Read once at mount — this page doesn't re-init the tab if the query
  // string changes underneath an already-open profile.
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<TabKey>(isAdmin && searchParams.get('openSms') === '1' ? 'sms' : 'overview');
  const { data: activities = [] } = useActivities(lead?.id);
  if (isLoading) return <div className="text-text-3">Loading…</div>;
  if (!lead) return <div className="text-text-3">Lead not found.</div>;
  const avatar = avatarColorFor(lead.id);

  return (
    <div>
      <div className="mb-3">
        <button onClick={() => navigate(backTo)} className="inline-flex items-center gap-1.5 text-[13px] text-text-3 hover:text-text">
          <ArrowLeft size={14} /> Back to Leads
        </button>
      </div>

      <div className="card mb-5 flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3.5">
            <span
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-[16px] font-bold"
              style={{ background: avatar.bg, color: avatar.text }}
            >
              {initials(lead.firstName, lead.lastName)}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <h1 className="text-[22px] font-extrabold tracking-tight text-text">
                  {lead.firstName} {lead.lastName}
                </h1>
                {lead.leadNum && <span className="text-[12px] text-text-3">#{lead.leadNum}</span>}
                <button className="text-text-3 hover:text-primary" title="Edit contact info" onClick={() => setEditContactOpen(true)}>
                  <Pencil size={13} />
                </button>
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
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

              <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13.5px] text-text-2">
                {lead.phone && (
                  <button
                    onClick={() => handleCall(lead.phone)}
                    className="inline-flex items-center gap-1 rounded hover:text-primary"
                    title={`Call ${formatPhone(lead.phone)}`}
                  >
                    <PhoneCall size={13} /> {formatPhone(lead.phone)}
                  </button>
                )}
                {lead.phone2 && (
                  <>
                    <span className="text-text-3">·</span>
                    <button
                      onClick={() => handleCall(lead.phone2)}
                      className="inline-flex items-center gap-1 rounded hover:text-primary"
                      title={`Call ${formatPhone(lead.phone2)}`}
                    >
                      <PhoneCall size={13} /> {formatPhone(lead.phone2)}
                    </button>
                  </>
                )}
                {lead.email && (
                  <>
                    <span className="text-text-3">·</span>
                    <span>{lead.email}</span>
                  </>
                )}
              </div>
              {lead.address && (
                <div className="mt-0.5 text-[13.5px] text-text-3">
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
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <AiScoreCard lead={lead} />
            {lead.phone && (
              <button onClick={() => handleCall(lead.phone)} className="btn btn-primary">
                <PhoneCall size={14} /> Call
              </button>
            )}
            {isAdmin && (
              <button onClick={() => setTab('sms')} className="btn">
                <MessageSquareText size={14} /> Text
              </button>
            )}
            <button onClick={() => setTab('deal')} className="btn">
              Send contract
            </button>
            <ShareMenu leadId={lead.id} stage={lead.stage} isAdmin={isAdmin} allowShare={allowShare} currentOwnerId={lead.userId} />
          </div>
        </div>

        <div className="border-t border-border-2 pt-3.5">
          <StageStepper
            lead={lead}
            isAdmin={isAdmin}
            activities={activities}
            onStageChange={(stage) => updateLead.mutate({ id: lead.id, stage })}
          />
        </div>
      </div>

      <div className="mb-4 flex gap-1 border-b border-border">
        {TABS.filter((t) => t !== 'sms' || isAdmin).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-3.5 py-2.5 text-[14px] font-semibold transition-colors',
              tab === t ? 'border-b-2 border-primary text-text' : 'border-b-2 border-transparent text-text-3 hover:text-text',
            )}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Activity gets the full width to itself — it's already a two-column
       *  layout on its own (the activity feed + Qualification Framework),
       *  so the usual 320px sidebar here would make it three columns
       *  cramped into the same row. Every other tab keeps the sidebar. */}
      <div className={`grid grid-cols-1 items-start gap-5 ${tab === 'activity' ? '' : 'lg:grid-cols-[1fr_320px]'}`}>
        <div className="min-w-0">
          {tab === 'overview' && (
            <OverviewTab lead={lead} onJumpToProperty={() => setTab('property')} onJumpToActivity={() => setTab('activity')} />
          )}
          {tab === 'sms' && isAdmin && <SmsThreadTab lead={lead} />}
          {tab === 'property' && <PropertyTab lead={lead} />}
          {tab === 'underwriting' && <UnderwritingTab lead={lead} />}
          {tab === 'deal' && <DealTab lead={lead} />}
          {tab === 'activity' && <ActivityTab lead={lead} />}
        </div>
        {tab !== 'activity' && (
          <div className="space-y-5">
            <ContactSidebarCard lead={lead} isAdmin={isAdmin} onCall={handleCall} />
            <TasksSidebarCard leadId={lead.id} ownerId={lead.userId} />
            <EventsSidebarCard lead={lead} />
            <OwnerSidebarCard lead={lead} />
          </div>
        )}
      </div>

      {editContactOpen && <EditContactModal lead={lead} onClose={() => setEditContactOpen(false)} />}
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

export function LeadProfilePage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const cameFromKanban = (location.state as { from?: string } | null)?.from === 'kanban';
  return <LeadProfileView id={id} backTo={cameFromKanban ? '/kanban' : '/leads'} allowShare />;
}
