import { Navigate, useParams } from 'react-router-dom';
import { useTeamMembers } from '@/hooks/useTeam';
import { LeadProfileView } from './LeadProfilePage';

export function MemberLeadProfilePage() {
  const { memberId, id } = useParams<{ memberId: string; id: string }>();
  const { data: members = [], isLoading } = useTeamMembers();

  if (isLoading) {
    return <div className="text-text-3">Loading…</div>;
  }

  const member = members.find((m) => m.memberId === memberId);
  if (!member) return <Navigate to="/team" replace />;

  return <LeadProfileView id={id} backTo={`/team/${memberId}/leads`} />;
}
