import { useState } from 'react';
import { Shield, UserPlus, Trash2, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useTeamMembers, useFindProfileByCode, useAddTeamMember, useRemoveTeamMember, useUpdateMemberRole } from '@/hooks/useTeam';
import { useLeads } from '@/hooks/useLeads';
import { useCallLog } from '@/hooks/useCallLog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { Role } from '@/types/domain';
import { localIsoDate } from '@/lib/utils';

const ROLE_LABELS: Record<Role, string> = { admin: 'Admin', manager: 'Manager', rep: 'Rep' };

function MemberStats({ memberId }: { memberId: string }) {
  const { data: leads = [], isLoading: leadsLoading } = useLeads(memberId);
  const { data: callLog = [], isLoading: logLoading } = useCallLog(memberId);

  if (leadsLoading || logLoading) {
    return <div className="mt-3 text-[12px] text-text-3">Loading their data…</div>;
  }

  const today = localIsoDate(new Date());
  const callsToday = callLog.filter((c) => c.createdAt.slice(0, 10) === today).length;
  const contracts = leads.filter((l) => l.status === 'contract').length;
  const followups = leads.filter((l) => ['followup', 'followup2', 'followup3'].includes(l.status)).length;

  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
      <div className="rounded-md border border-border-2 bg-surface-3 p-2.5 text-center">
        <div className="font-mono text-lg font-bold text-blue-bright">{leads.length}</div>
        <div className="text-[10px] uppercase tracking-wide text-text-3">Leads</div>
      </div>
      <div className="rounded-md border border-border-2 bg-surface-3 p-2.5 text-center">
        <div className="font-mono text-lg font-bold text-text">{callLog.length}</div>
        <div className="text-[10px] uppercase tracking-wide text-text-3">Total Calls</div>
      </div>
      <div className="rounded-md border border-border-2 bg-surface-3 p-2.5 text-center">
        <div className="font-mono text-lg font-bold text-amber">{callsToday}</div>
        <div className="text-[10px] uppercase tracking-wide text-text-3">Calls Today</div>
      </div>
      <div className="rounded-md border border-border-2 bg-surface-3 p-2.5 text-center">
        <div className="font-mono text-lg font-bold text-purple">{followups}</div>
        <div className="text-[10px] uppercase tracking-wide text-text-3">Follow-Ups</div>
      </div>
      <div className="rounded-md border border-border-2 bg-surface-3 p-2.5 text-center">
        <div className="font-mono text-lg font-bold text-green">{contracts}</div>
        <div className="text-[10px] uppercase tracking-wide text-text-3">Contracts</div>
      </div>
    </div>
  );
}

export function TeamPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const { data: members = [] } = useTeamMembers();
  const findByCode = useFindProfileByCode();
  const addMember = useAddTeamMember();
  const removeMember = useRemoveTeamMember();
  const updateRole = useUpdateMemberRole();

  const [code, setCode] = useState('');
  const [lookupError, setLookupError] = useState('');
  const [found, setFound] = useState<{ id: string; user_code: string; caller_name: string | null; email: string } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

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
        <h1 className="font-display text-2xl font-semibold text-text">Team</h1>
        <p className="text-sm text-text-3">Manage who reports to you and review their calling activity.</p>
      </div>

      <div className="card mb-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <Shield size={15} className="text-blue-bright" /> Your role
        </div>
        <div className="mt-2 flex items-center gap-3">
          <span className="rounded-full bg-blue-dim px-2.5 py-1 text-[12px] font-semibold text-blue-bright">{ROLE_LABELS[profile?.role ?? 'rep']}</span>
          <span className="font-mono text-[12px] text-text-3">Your code: {profile?.userCode}</span>
        </div>
        <p className="mt-2 text-[12px] text-text-3">Share your code with reps, or ask the person you want to oversee for theirs.</p>
      </div>

      <div className="card mb-4">
        <div className="text-sm font-semibold text-text">Add team member</div>
        <p className="mt-1 text-[13px] text-text-2">Look up a user by their account code and add them to your team to view their calling activity.</p>
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

        {lookupError && <div className="mt-2 text-[12px] text-red">{lookupError}</div>}

        {found && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-border-2 bg-surface-3 p-3">
            <div>
              <div className="text-[13px] font-medium text-text">{found.caller_name || found.email}</div>
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
                  <div className="text-[13px] font-medium text-text">{m.member.callerName || m.member.email}</div>
                  <div className="text-[11px] text-text-3">{m.member.email} · code {m.member.userCode}</div>
                </div>
                <div className="flex items-center gap-2">
                  {isAdmin ? (
                    <select
                      className="input !w-auto !py-1 text-[12px]"
                      value={m.member.role}
                      onChange={(e) => updateRole.mutate({ id: m.memberId, role: e.target.value as Role })}
                    >
                      <option value="rep">Rep</option>
                      <option value="manager">Manager</option>
                      <option value="admin">Admin</option>
                    </select>
                  ) : (
                    <span className="rounded-full bg-surface-4 px-2 py-0.5 text-[11px] text-text-2">{ROLE_LABELS[m.member.role]}</span>
                  )}
                  <button
                    className="btn !px-2 !py-1"
                    onClick={() => setExpanded(expanded === m.memberId ? null : m.memberId)}
                    title={expanded === m.memberId ? 'Hide activity' : 'View activity'}
                  >
                    {expanded === m.memberId ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                  <button className="btn !px-2 !py-1 text-red hover:border-red" onClick={() => setRemoveTarget(m.id)} title="Remove from team">
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
        message="Remove this person from your team? You'll no longer be able to view their calling activity."
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
