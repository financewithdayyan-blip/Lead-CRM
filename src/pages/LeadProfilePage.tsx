import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Pencil, RefreshCw, Share2, ArrowRightLeft, Sparkles, PhoneCall } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLead, useUpdateLead, useSetLeadTags } from '@/hooks/useLeads';
import { useTags, useCreateTag, nextTagColor } from '@/hooks/useTags';
import { useAddActivity } from '@/hooks/useActivities';
import { useMyPendingShareForLead, useShareLead, useAdminShareLeadToCaller, useTransferLeadToAdmin } from '@/hooks/useLeadShares';
import { useTeamMembers } from '@/hooks/useTeam';
import { useScoreLead } from '@/hooks/useScoreLead';
import { StageBadge } from '@/components/ui/StageBadge';
import { TagPill } from '@/components/ui/TagPill';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { STAGE_CONFIG, visibleStagesFor, type Lead, type LeadStage, type Tag } from '@/types/domain';
import { formatPhone, toE164 } from '@/lib/utils';
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

/** Compact — just the badge and a re-score link, meant to sit under the
 *  stage dropdown in the header's right-aligned column. The reasoning text
 *  that used to run alongside it lives in Overview's Notes card now (as a
 *  Legacy note), not here. */
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
    <div className="flex flex-col items-end gap-1.5">
      {hasScore && colors ? (
        <div className="flex items-center gap-2.5">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ring-2 ${colors.ring} bg-surface-2`}>
            <span className={`text-[15px] font-bold ${colors.text}`}>{lead.aiScore}</span>
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-text">
              <Sparkles size={12} className={colors.text} />
              AI Lead Score
              <span className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold ${colors.bg} text-white`}>{colors.label}</span>
            </div>
            {scoredDate && <div className="text-[10.5px] text-text-3">Scored {scoredDate}</div>}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-[12px] text-text-3">
          <Sparkles size={13} className="text-primary" />
          No AI score yet
        </div>
      )}
      <button
        onClick={handleScore}
        disabled={scoreLead.isPending}
        className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
      >
        {scoreLead.isPending ? (
          <><RefreshCw size={11} className="animate-spin" /> Scoring…</>
        ) : (
          hasScore ? 'Re-score' : 'Score with AI'
        )}
      </button>
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
        className="btn !p-2"
        title={pendingShare ? 'Pending admin approval' : 'Share this lead'}
      >
        <Share2 size={15} className={pendingShare ? 'text-warning' : undefined} />
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
  if (isLoading) return <div className="text-text-3">Loading…</div>;
  if (!lead) return <div className="text-text-3">Lead not found.</div>;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => navigate(backTo)} className="inline-flex items-center gap-1.5 text-[13px] text-text-3 hover:text-text">
          <ArrowLeft size={14} /> Back to Leads
        </button>
        <ShareMenu leadId={lead.id} stage={lead.stage} isAdmin={isAdmin} allowShare={allowShare} currentOwnerId={lead.userId} />
      </div>

      <div className="card mb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-semibold text-text">
                {lead.firstName} {lead.lastName}
              </h1>
              <StageBadge stage={lead.stage} />
              {lead.leadNum && <span className="text-[12px] text-text-3">#{lead.leadNum}</span>}
              <button
                className="text-text-3 hover:text-primary"
                title="Edit contact info"
                onClick={() => setEditContactOpen(true)}
              >
                <Pencil size={13} />
              </button>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-text-2">
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
              onChange={(e) => updateLead.mutate({ id: lead.id, stage: e.target.value as LeadStage })}
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
            <AiScoreCard lead={lead} />
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
