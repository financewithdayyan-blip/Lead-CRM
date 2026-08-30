import { Navigate, useParams, useLocation } from 'react-router-dom';
import { useTeamMembers } from '@/hooks/useTeam';
import { LeadProfileView } from './LeadProfilePage';

export function MemberLeadProfilePage() {
  const { memberId, id } = useParams<{ memberId: string; id: string }>();
  const location = useLocation();
  const { data: members = [], isLoading: membersLoading } = useTeamMembers();
  const member = members.find((m) => m.memberId === memberId);

  if (!membersLoading && members.length > 0 && !member) return <Navigate to="/team" replace />;

  const cameFromKanban = (location.state as { from?: string } | null)?.from === 'kanban';
  const backTo = cameFromKanban ? `/team/${memberId}/kanban` : `/team/${memberId}/leads`;
  return <LeadProfileView id={id} backTo={backTo} />;
}
