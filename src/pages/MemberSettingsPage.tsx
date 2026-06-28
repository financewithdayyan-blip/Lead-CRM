import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTeamMembers, useUpdateMemberGoals } from '@/hooks/useTeam';

export function MemberSettingsPage() {
  const { memberId } = useParams<{ memberId: string }>();
  const { data: members = [], isLoading } = useTeamMembers();
  const updateGoals = useUpdateMemberGoals();

  const member = members.find((m) => m.memberId === memberId);

  const [dailyGoal, setDailyGoal] = useState(String(member?.member.dailyGoal ?? 20));
  const [monthlyGoal, setMonthlyGoal] = useState(String(member?.member.monthlyGoal ?? 400));
  const [saved, setSaved] = useState(false);

  if (isLoading) {
    return <div className="text-text-3">Loading…</div>;
  }
  if (!member) return <Navigate to="/team" replace />;

  const name = member.member.fullName || member.member.email;

  function handleSave() {
    if (!memberId) return;
    const daily = parseInt(dailyGoal, 10);
    const monthly = parseInt(monthlyGoal, 10);
    if (isNaN(daily) || daily < 1 || isNaN(monthly) || monthly < 1) return;
    updateGoals.mutate(
      { id: memberId, dailyGoal: daily, monthlyGoal: monthly },
      {
        onSuccess: () => {
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        },
      },
    );
  }

  return (
    <div>
      <Link to={`/team/${memberId}`} className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-text-3 hover:text-text">
        <ArrowLeft size={14} /> Back to {name}'s Dashboard
      </Link>

      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-text">{name}'s Settings</h1>
        <p className="text-sm text-text-3">Set their daily and monthly call targets. They can't change these themselves.</p>
      </div>

      <div className="card">
        <div className="text-sm font-semibold text-text">Call Targets</div>
        <p className="mt-1 text-[13px] text-text-2">Tracked on their dashboard's daily and monthly goal bars.</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Daily target</label>
            <input
              className="input max-w-[140px]"
              type="number"
              min={1}
              value={dailyGoal}
              onChange={(e) => setDailyGoal(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            />
          </div>
          <div>
            <label className="label">Monthly target</label>
            <input
              className="input max-w-[140px]"
              type="number"
              min={1}
              value={monthlyGoal}
              onChange={(e) => setMonthlyGoal(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            />
          </div>
          <button className="btn btn-primary" onClick={handleSave}>
            Save
          </button>
          {saved && <span className="text-[11px] text-success">✓ Saved</span>}
        </div>
      </div>
    </div>
  );
}
