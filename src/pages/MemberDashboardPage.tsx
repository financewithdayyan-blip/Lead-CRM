import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTeamMembers } from '@/hooks/useTeam';
import { DashboardView } from './DashboardPage';

export function MemberDashboardPage() {
  const { memberId } = useParams<{ memberId: string }>();
  const { data: members = [], isLoading: membersLoading } = useTeamMembers();
  const member = members.find((m) => m.memberId === memberId);

  // Only redirect once members have loaded and this ID genuinely isn't found
  if (!membersLoading && members.length > 0 && !member) return <Navigate to="/team" replace />;

  const name = member ? (member.member.fullName || member.member.email) : '';

  return (
    <div>
      <Link to="/team" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-text-3 hover:text-text">
        <ArrowLeft size={14} /> Back to Team
      </Link>
      {/* Start rendering immediately with memberId — don't wait for useTeamMembers */}
      <DashboardView
        userId={memberId!}
        profile={member?.member ?? null}
        heading={name ? `${name}'s Dashboard` : 'Dashboard'}
        subtitle={name ? `${name}'s pipeline and activity at a glance` : 'Member pipeline and activity at a glance'}
      />
    </div>
  );
}
