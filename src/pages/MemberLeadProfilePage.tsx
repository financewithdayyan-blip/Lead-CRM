import { Navigate, useParams } from 'react-router-dom';
import { useTeamMembers } from '@/hooks/useTeam';
import { LeadProfileView } from './LeadProfilePage';

export function MemberLeadProfilePage() {
  const { memberId, id } = useParams<{ memberId: string; id: string }>();
  const { data: members = [], isLoading: membersLoading } = useTeamMembers();
  const member = members.find((m) => m.memberId === memberId);

  if (!membersLoading && members.length > 0 && !member) return <Navigate to="/team" replace />;

  return <LeadProfileView id={id} backTo={`/team/${memberId}/leads`} />;
}
