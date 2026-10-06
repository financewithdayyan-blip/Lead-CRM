import { useAuth } from '@/contexts/AuthContext';
import { useTeamMembers } from '@/hooks/useTeam';
import { initials } from '@/lib/utils';
import type { Lead } from '@/types/domain';

export function OwnerSidebarCard({ lead }: { lead: Lead }) {
  const { profile } = useAuth();
  const { data: members = [] } = useTeamMembers();
  const owner = profile?.id === lead.userId ? profile : members.find((m) => m.memberId === lead.userId)?.member;
  const name = owner?.fullName || owner?.email || 'Unassigned';
  const [first, last] = name.split(' ');

  return (
    <div className="card !bg-sidebar !p-4">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-sidebar-text">Owner</div>
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-[12px] font-bold text-sidebar">
          {initials(first ?? '', last ?? '')}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-semibold text-sidebar-textActive">{name}</div>
          <div className="truncate text-[11.5px] text-sidebar-text">Lead source: {lead.source || 'Unknown'}</div>
        </div>
      </div>
    </div>
  );
}
