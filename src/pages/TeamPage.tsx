import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shield, UserPlus, Trash2, ChevronDown, LayoutDashboard, Mail, Copy, Clock, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useTeamMembers, useRemoveTeamMember, useUpdateMemberRole, useTeamInvites, useSendInvite, useRevokeInvite } from '@/hooks/useTeam';
import { useLeads } from '@/hooks/useLeads';
import { useActivityFeed } from '@/hooks/useActivities';
import { aggregateTodayAttendance, useAttendanceSessions, useTeamTodaySessions } from '@/hooks/useAttendance';
import { nextTagColor } from '@/hooks/useTags';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { usePresence } from '@/contexts/PresenceContext';
import type { Role } from '@/types/domain';
import { formatDuration, formatTime, getErrorMessage, initials, localIsoDate } from '@/lib/utils';

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

function formatDayLabel(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function MemberAttendance({ memberId }: { memberId: string }) {
  const { data: sessions = [], isLoading } = useAttendanceSessions(memberId);
  const todayIso = localIsoDate(new Date());

  if (isLoading) return <div className="mt-3 text-[12px] text-text-3">Loading attendance…</div>;
  if (sessions.length === 0) return <div className="mt-3 text-[12px] text-text-3">No attendance recorded yet.</div>;

  const days = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const day = localIsoDate(new Date(s.startedAt));
    days.set(day, [...(days.get(day) ?? []), s]);
  }

  // Sessions with no ended_at are either genuinely active (started today) or orphaned
  // (browser closed before the cleanup hook ran). Cap orphaned sessions at midnight of
  // the day they started so stale rows don't inflate past-day totals.
  function effectiveEndMs(endedAt: string | null, sessionDay: string): number {
    if (endedAt) return new Date(endedAt).getTime();
    if (sessionDay === todayIso) return Date.now();
    const [y, m, d] = sessionDay.split('-').map(Number);
    return new Date(y, m - 1, d + 1, 0, 0, 0, 0).getTime(); // midnight = end of that calendar day
  }

  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
        <Clock size={12} /> Attendance (last 14 days)
      </div>
      <div className="space-y-1.5">
        {Array.from(days.entries()).map(([day, daySessions]) => {
          const totalSeconds = daySessions.reduce(
            (sum, s) => sum + Math.max(0, (effectiveEndMs(s.endedAt, day) - new Date(s.startedAt).getTime()) / 1000),
            0,
          );
          const ordered = [...daySessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
          return (
            <div key={day} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-2 bg-surface-3 p-2 text-[12px]">
              <div className="font-medium text-text">{formatDayLabel(day)}</div>
              <div className="text-text-2">
                {ordered.map((s, i) => {
                  const isLiveSession = !s.endedAt && day === todayIso;
                  return (
                    <span key={s.id}>
                      {i > 0 && ', '}
                      {formatTime(s.startedAt)}–{s.endedAt ? formatTime(s.endedAt) : isLiveSession ? 'ongoing' : '?'}
                    </span>
                  );
                })}
              </div>
              <div className="font-mono font-semibold text-primary">{formatDuration(totalSeconds)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TeamPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const { data: members = [] } = useTeamMembers();
  const { data: invites = [] } = useTeamInvites();
  const { onlineIds, statusMap } = usePresence();
  const { data: todaySessions = [] } = useTeamTodaySessions();
  const todayAttendance = useMemo(() => aggregateTodayAttendance(todaySessions), [todaySessions]);
  const removeMember = useRemoveTeamMember();
  const updateRole = useUpdateMemberRole();
  const sendInvite = useSendInvite();
  const revokeInvite = useRevokeInvite();

  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('caller');
  const [inviteError, setInviteError] = useState('');
  const [inviteSent, setInviteSent] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const pendingInvites = invites.filter((i) => i.status === 'pending');

  function inviteLink(email: string) {
    return `${window.location.origin}/crm/login?invite=1&email=${encodeURIComponent(email)}`;
  }

  function handleInvite() {
    setInviteError('');
    setInviteSent('');
    const email = inviteEmail.trim();
    if (!email) return;
    if (members.some((m) => m.member.email.toLowerCase() === email.toLowerCase())) {
      setInviteError('That person is already on your team.');
      return;
    }
    sendInvite.mutate(
      { email, role: inviteRole },
      {
        onSuccess: () => {
          setInviteSent(`Invite email sent to ${email}.`);
          setInviteEmail('');
          setInviteRole('caller');
        },
        onError: (err) => setInviteError(getErrorMessage(err, 'Could not send invite.')),
      },
    );
  }

  function copyLink(id: string, email: string) {
    navigator.clipboard.writeText(inviteLink(email));
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
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
            They'll get an official invite email with a link to set their password - their account is created and added to your team
            automatically once they do.
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
                  setInviteSent('');
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
            <button className="btn btn-primary" onClick={handleInvite} disabled={sendInvite.isPending}>
              <UserPlus size={14} /> {sendInvite.isPending ? 'Sending…' : 'Send Invite'}
            </button>
          </div>
          {inviteError && <div className="mt-2 text-[12px] text-danger">{inviteError}</div>}
          {inviteSent && <div className="mt-2 text-[12px] text-success">{inviteSent}</div>}

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
                    <button
                      className="btn !px-2.5 !py-1 text-[12px]"
                      onClick={() => sendInvite.mutate({ email: inv.email, role: inv.role })}
                      disabled={sendInvite.isPending}
                      title="Resend the invite email"
                    >
                      <Mail size={12} /> Resend
                    </button>
                    <button className="btn !px-2.5 !py-1 text-[12px]" onClick={() => copyLink(inv.id, inv.email)} title="Copy a manual signup link as a fallback">
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

      <div className="card">
        <div className="text-sm font-semibold text-text">Your team ({members.length})</div>
        {members.length === 0 && <div className="mt-3 text-[13px] text-text-3">You aren't overseeing anyone yet.</div>}

        <div className="mt-3 space-y-2.5">
          {members.map((m, i) => {
            const isOnline = onlineIds.has(m.memberId);
            const inSession = statusMap[m.memberId] === 'session';
            const today = todayAttendance[m.memberId];
            const [mFirst, mLast] = (m.member.fullName ?? '').split(' ');
            const avatarColor = nextTagColor(i);
            const isExpanded = expanded === m.memberId;

            return (
              <div
                key={m.id}
                className="rounded-lg border border-border-2 bg-surface-3 p-3.5 transition-colors hover:border-border"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="relative shrink-0">
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-full text-[13px] font-semibold"
                        style={{ backgroundColor: avatarColor.bg, color: avatarColor.text }}
                      >
                        {initials(mFirst || m.member.email, mLast ?? '')}
                      </div>
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface-3 ${inSession ? 'bg-red-500' : isOnline ? 'bg-emerald-500' : 'bg-slate-300'}`}
                        title={inSession ? 'In session' : isOnline ? 'Online' : 'Offline'}
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[14px] font-semibold text-text">{m.member.fullName || m.member.email}</span>
                        <select
                          className={`rounded-full border-0 py-0.5 pl-2.5 pr-6 text-[10px] font-semibold uppercase tracking-wide outline-none ${
                            m.member.role === 'admin' ? 'bg-primary-dim text-primary-text' : 'bg-surface-2 text-text-2'
                          }`}
                          value={m.member.role}
                          onChange={(e) => updateRole.mutate({ id: m.memberId, role: e.target.value as Role })}
                        >
                          <option value="caller">Caller</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                      <div className="mt-0.5 truncate text-[12px] text-text-3">
                        {m.member.email} · code {m.member.userCode}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className={`text-[12px] font-medium ${inSession ? 'text-red-500' : isOnline ? 'text-emerald-600' : 'text-text-3'}`}>
                          {inSession ? 'In session' : isOnline ? 'Online now' : today ? `Offline · last seen ${formatTime(today.lastSeenAt)}` : 'Offline'}
                        </span>
                        {today && today.seconds > 0 && (
                          <span className="flex items-center gap-1 rounded-full bg-primary-dim px-2 py-0.5 text-[11px] font-medium text-primary-text">
                            <Clock size={10} /> {formatDuration(today.seconds)} today
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <Link to={`/team/${m.memberId}`} className="btn !px-2.5 !py-1 text-[12px]" title="Open full dashboard">
                      <LayoutDashboard size={13} /> Dashboard
                    </Link>
                    <button
                      className="btn !px-2 !py-1"
                      onClick={() => setExpanded(isExpanded ? null : m.memberId)}
                      title={isExpanded ? 'Hide stats & attendance' : 'View stats & attendance'}
                    >
                      <ChevronDown size={14} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>
                    <button className="btn !px-2 !py-1 text-danger hover:border-danger" onClick={() => setRemoveTarget(m.memberId)} title="Remove from team">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="mt-3 border-t border-border-2 pt-3">
                    <MemberStats memberId={m.memberId} />
                    <MemberAttendance memberId={m.memberId} />
                  </div>
                )}
              </div>
            );
          })}
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
