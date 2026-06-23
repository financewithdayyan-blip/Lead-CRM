import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Shield, UserPlus, Trash2, Eye, EyeOff, LayoutDashboard, Mail, Copy, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  useTeamMembers,
  useFindProfileByCode,
  useAddTeamMember,
  useRemoveTeamMember,
  useUpdateMemberRole,
  useTeamInvites,
  useCreateInvite,
  useRevokeInvite,
} from '@/hooks/useTeam';
import { useLeads } from '@/hooks/useLeads';
import { useActivityFeed } from '@/hooks/useActivities';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { Role } from '@/types/domain';
import { localIsoDate } from '@/lib/utils';

const ROLE_LABELS: Record<Role, string> = { admin: 'Admin', caller: 'Caller' };

function MemberStats({ memberId }: { memberId: string }) {
  const { data: leads = [], isLoading: leadsLoading } = useLeads(memberId);
  const { data: activities = [], isLoading: activityLoading } = useActivityFeed(memberId);

  if (leadsLoading || activityLoading) {
    return <div className="mt-3 text-[12px] text-text-3">Loading their data…</div>;
  }

  const calls = activities.filter((a) => a.type === 'call');
  const today = localIsoDate(new Date());
  const callsToday = calls.filter((c) => localIsoDate(new Date(c.createdAt)) === today).length;
  const contracts = leads.filter((l) => l.stage === 'contract').length;
  const followups = leads.filter((l) => ['initial_contact', 'followup', 'negotiation'].includes(l.stage)).length;

  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
      <div className="rounded-md border border-border-2 bg-surface-3 p-2.5 text-center">
        <div className="font-mono text-lg font-bold text-primary">{leads.length}</div>
        <div className="text-[10px] uppercase tracking-wide text-text-3">Leads</div>
      </div>
      <div className="rounded-md border border-border-2 bg-surface-3 p-2.5 text-center">
        <div className="font-mono text-lg font-bold text-text">{calls.length}</div>
        <div className="text-[10px] uppercase tracking-wide text-text-3">Total Calls</div>
      </div>
      <div className="rounded-md border border-border-2 bg-surface-3 p-2.5 text-center">
        <div className="font-mono text-lg font-bold text-warning">{callsToday}</div>
        <div className="text-[10px] uppercase tracking-wide text-text-3">Calls Today</div>
      </div>
      <div className="rounded-md border border-border-2 bg-surface-3 p-2.5 text-center">
        <div className="font-mono text-lg font-bold text-[#a78bfa]">{followups}</div>
        <div className="text-[10px] uppercase tracking-wide text-text-3">Follow-Ups</div>
      </div>
      <div className="rounded-md border border-border-2 bg-surface-3 p-2.5 text-center">
        <div className="font-mono text-lg font-bold text-success">{contracts}</div>
        <div className="text-[10px] uppercase tracking-wide text-text-3">Contracts</div>
      </div>
    </div>
  );
}

export function TeamPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const { data: members = [] } = useTeamMembers();
  const { data: invites = [] } = useTeamInvites();
  const findByCode = useFindProfileByCode();
  const addMember = useAddTeamMember();
  const removeMember = useRemoveTeamMember();
  const updateRole = useUpdateMemberRole();
  const createInvite = useCreateInvite();
  const revokeInvite = useRevokeInvite();

  const [code, setCode] = useState('');
  const [lookupError, setLookupError] = useState('');
  const [found, setFound] = useState<{ id: string; user_code: string; full_name: string | null; email: string } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('caller');
  const [inviteError, setInviteError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const pendingInvites = invites.filter((i) => i.status === 'pending');

  function inviteLink(email: string) {
    return `${window.location.origin}/login?invite=1&email=${encodeURIComponent(email)}`;
  }

  function handleInvite() {
    setInviteError('');
    const email = inviteEmail.trim();
    if (!email) return;
    if (members.some((m) => m.member.email.toLowerCase() === email.toLowerCase())) {
      setInviteError('That person is already on your team.');
      return;
    }
    if (pendingInvites.some((i) => i.email.toLowerCase() === email.toLowerCase())) {
      setInviteError('There is already a pending invite for that email.');
      return;
    }
    createInvite.mutate(
      { email, role: inviteRole },
      {
        onSuccess: () => {
          setInviteEmail('');
          setInviteRole('caller');
        },
        onError: (err) => setInviteError(err instanceof Error ? err.message : 'Could not create invite.'),
      },
    );
  }

  function copyLink(id: string, email: string) {
    navigator.clipboard.writeText(inviteLink(email));
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  async function handleLookup() {
    setLookupError('');
    setFound(null);
    const trimmed = code.trim();
    if (!trimmed) return;
    const result = await findByCode.mutateAsync(trimmed);
    if (!result) {
      setLookupError('No user found with that code.');
      return;
    }
    if (members.some((m) => m.memberId === result.id)) {
      setLookupError('That user is already on your team.');
      return;
    }
    if (result.id === profile?.id) {
      setLookupError("That's your own code.");
      return;
    }
    setFound(result);
  }

  function handleAdd() {
    if (!found) return;
    addMember.mutate(found.id, {
      onSuccess: () => {
        setFound(null);
        setCode('');
      },
    });
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-text">Team</h1>
        <p className="text-sm text-text-3">Manage who reports to you and review their activity.</p>
      </div>

      <div className="card mb-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <Shield size={15} className="text-primary" /> Your role
        </div>
        <div className="mt-2 flex items-center gap-3">
          <span className="rounded-full bg-primary-dim px-2.5 py-1 text-[12px] font-semibold text-primary-text">{ROLE_LABELS[profile?.role ?? 'caller']}</span>
          <span className="font-mono text-[12px] text-text-3">Your code: {profile?.userCode}</span>
        </div>
        <p className="mt-2 text-[12px] text-text-3">Share your code with callers, or ask the person you want to oversee for theirs.</p>
      </div>

      {isAdmin && (
        <div className="card mb-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-text">
            <Mail size={15} className="text-primary" /> Invite by email
          </div>
          <p className="mt-1 text-[13px] text-text-2">
            Create an invite and share the link with them - when they sign up with that email, they're added to your team automatically.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Email</label>
              <input
                className="input max-w-[220px]"
                type="email"
                placeholder="name@example.com"
                value={inviteEmail}
                onChange={(e) => {
                  setInviteEmail(e.target.value);
                  setInviteError('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
              />
            </div>
            <div>
              <label className="label">Role</label>
              <select className="input max-w-[140px]" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)}>
                <option value="caller">Caller</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button className="btn btn-primary" onClick={handleInvite} disabled={createInvite.isPending}>
              <UserPlus size={14} /> Create invite
            </button>
          </div>
          {inviteError && <div className="mt-2 text-[12px] text-danger">{inviteError}</div>}

          {pendingInvites.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Pending invites ({pendingInvites.length})</div>
              {pendingInvites.map((inv) => (
                <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-2 bg-surface-3 p-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-text">{inv.email}</div>
                    <div className="text-[11px] text-text-3">{ROLE_LABELS[inv.role]}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button className="btn !px-2.5 !py-1 text-[12px]" onClick={() => copyLink(inv.id, inv.email)}>
                      <Copy size={12} /> {copiedId === inv.id ? 'Copied!' : 'Copy link'}
                    </button>
                    <button
                      className="btn !px-2 !py-1 text-danger hover:border-danger"
                      onClick={() => revokeInvite.mutate(inv.id)}
                      title="Revoke invite"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card mb-4">
        <div className="text-sm font-semibold text-text">Add by code</div>
        <p className="mt-1 text-[13px] text-text-2">
          Already have an account? Look up by account code and add them to your team to view their activity.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="label">User code</label>
            <input
              className="input max-w-[160px] uppercase"
              placeholder="e.g. A1B2C3"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setFound(null);
                setLookupError('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
            />
          </div>
          <button className="btn" onClick={handleLookup} disabled={findByCode.isPending}>
            Look up
          </button>
        </div>

        {lookupError && <div className="mt-2 text-[12px] text-danger">{lookupError}</div>}

        {found && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-border-2 bg-surface-3 p-3">
            <div>
              <div className="text-[13px] font-medium text-text">{found.full_name || found.email}</div>
              <div className="text-[11px] text-text-3">{found.email}</div>
            </div>
            <button className="btn btn-primary" onClick={handleAdd}>
              <UserPlus size={14} /> Add to team
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="text-sm font-semibold text-text">Your team ({members.length})</div>
        {members.length === 0 && <div className="mt-3 text-[13px] text-text-3">You aren't overseeing anyone yet.</div>}

        <div className="mt-3 space-y-2">
          {members.map((m) => (
            <div key={m.id} className="rounded-md border border-border-2 bg-surface-3 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] font-medium text-text">{m.member.fullName || m.member.email}</div>
                  <div className="text-[11px] text-text-3">{m.member.email} · code {m.member.userCode}</div>
                </div>
                <div className="flex items-center gap-2">
                  {isAdmin ? (
                    <select
                      className="input !w-auto !py-1 text-[12px]"
                      value={m.member.role}
                      onChange={(e) => updateRole.mutate({ id: m.memberId, role: e.target.value as Role })}
                    >
                      <option value="caller">Caller</option>
                      <option value="admin">Admin</option>
                    </select>
                  ) : (
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-text-2">{ROLE_LABELS[m.member.role]}</span>
                  )}
                  <button
                    className="btn !px-2 !py-1"
                    onClick={() => setExpanded(expanded === m.memberId ? null : m.memberId)}
                    title={expanded === m.memberId ? 'Hide quick stats' : 'View quick stats'}
                  >
                    {expanded === m.memberId ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                  <Link to={`/team/${m.memberId}`} className="btn !px-2.5 !py-1 text-[12px]" title="Open full dashboard">
                    <LayoutDashboard size={13} /> Dashboard
                  </Link>
                  <button className="btn !px-2 !py-1 text-danger hover:border-danger" onClick={() => setRemoveTarget(m.id)} title="Remove from team">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              {expanded === m.memberId && <MemberStats memberId={m.memberId} />}
            </div>
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={!!removeTarget}
        title="Remove team member"
        message="Remove this person from your team? You'll no longer be able to view their activity."
        confirmLabel="Remove"
        danger
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => {
          if (removeTarget) removeMember.mutate(removeTarget);
          setRemoveTarget(null);
        }}
      />
    </div>
  );
}
