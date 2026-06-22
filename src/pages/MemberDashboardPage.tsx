import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTeamMembers } from '@/hooks/useTeam';
import { DashboardView } from './DashboardPage';

export function MemberDashboardPage() {
  const { memberId } = useParams<{ memberId: string }>();
  const { data: members = [], isLoading } = useTeamMembers();

  if (isLoading) {
    return <div className="text-text-3">Loading…</div>;
  }

  const member = members.find((m) => m.memberId === memberId);
  if (!member) return <Navigate to="/team" replace />;

  const name = member.member.fullName || member.member.email;

  return (
    <div>
      <Link to="/team" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-text-3 hover:text-text">
        <ArrowLeft size={14} /> Back to Team
      </Link>
      <DashboardView
        userId={member.memberId}
        profile={member.member}
        heading={`${name}'s Dashboard`}
        subtitle={`${name}'s pipeline and activity at a glance`}
      />
    </div>
  );
}
