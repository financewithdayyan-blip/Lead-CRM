import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTeamMembers } from '@/hooks/useTeam';
import { KanbanView } from './KanbanPage';

export function MemberKanbanPage() {
  const { memberId } = useParams<{ memberId: string }>();
  const { data: members = [], isLoading: membersLoading } = useTeamMembers();
  const member = members.find((m) => m.memberId === memberId);

  if (!membersLoading && members.length > 0 && !member) return <Navigate to="/team" replace />;

  const name = member ? (member.member.fullName || member.member.email) : '';

  return (
    <div>
      <Link
        to={`/team/${memberId}`}
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-text-3 hover:text-text"
      >
        <ArrowLeft size={14} /> {name ? `Back to ${name}'s Dashboard` : 'Back to Dashboard'}
      </Link>
      <KanbanView targetUserId={memberId!} viewOnly />
    </div>
  );
}
