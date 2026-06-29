import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { dbToAttendanceSession } from '@/lib/mappers';
import { useAuth } from '@/contexts/AuthContext';
import { localIsoDate } from '@/lib/utils';

/** Recent clock-in/out history for one user, newest first - powers the detailed attendance log on their team card. */
export function useAttendanceSessions(userId: string | undefined) {
  return useQuery({
    queryKey: ['attendance_sessions', userId],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 14);
      const { data, error } = await supabase
        .from('attendance_sessions')
        .select('*')
        .eq('user_id', userId)
        .gte('started_at', since.toISOString())
        .order('started_at', { ascending: false });
      if (error) throw error;
      return data.map(dbToAttendanceSession);
    },
    enabled: !!userId,
  });
}

export interface TodayAttendance {
  seconds: number;
  lastSeenAt: string;
}

/** Today's online total + last-seen time per team member, for the always-visible badge on each member's card. */
export function useTeamTodayAttendance() {
  const { session, profile } = useAuth();
  const ownerId = session?.user.id;
  const todayIso = localIsoDate(new Date());
  return useQuery({
    queryKey: ['attendance_sessions', 'team_today', ownerId, todayIso],
    queryFn: async () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from('attendance_sessions')
        .select('user_id, started_at, ended_at')
        .gte('started_at', start.toISOString())
        .neq('user_id', ownerId);
      if (error) throw error;
      const totals: Record<string, TodayAttendance> = {};
      for (const row of data) {
        const seconds = Math.max(0, (new Date(row.ended_at).getTime() - new Date(row.started_at).getTime()) / 1000);
        const prev = totals[row.user_id];
        totals[row.user_id] = {
          seconds: (prev?.seconds ?? 0) + seconds,
          lastSeenAt: !prev || row.ended_at > prev.lastSeenAt ? row.ended_at : prev.lastSeenAt,
        };
      }
      return totals;
    },
    enabled: !!ownerId && profile?.role === 'admin',
    refetchInterval: 60_000,
  });
}
