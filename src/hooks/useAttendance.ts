import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { dbToAttendanceSession } from '@/lib/mappers';
import { useAuth } from '@/contexts/AuthContext';
import type { AttendanceSession } from '@/types/domain';
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

/** Today's attendance_sessions rows across the whole team - shared by the Team page badges and the presence notifications. */
export function useTeamTodaySessions() {
  const { session, profile } = useAuth();
  const ownerId = session?.user.id;
  const todayIso = localIsoDate(new Date());
  return useQuery({
    queryKey: ['attendance_sessions', 'team_today', ownerId, todayIso],
    queryFn: async () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const { data, error } = await supabase.from('attendance_sessions').select('*').gte('started_at', start.toISOString()).neq('user_id', ownerId);
      if (error) throw error;
      return data.map(dbToAttendanceSession);
    },
    enabled: !!ownerId && profile?.role === 'admin',
    refetchInterval: 60_000,
  });
}

export interface TodayAttendance {
  seconds: number;
  lastSeenAt: string;
}

/** Reduces today's sessions into a per-member online total + last-seen time. */
export function aggregateTodayAttendance(sessions: AttendanceSession[]): Record<string, TodayAttendance> {
  const totals: Record<string, TodayAttendance> = {};
  for (const s of sessions) {
    const seconds = Math.max(0, (new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 1000);
    const prev = totals[s.userId];
    totals[s.userId] = {
      seconds: (prev?.seconds ?? 0) + seconds,
      lastSeenAt: !prev || s.endedAt > prev.lastSeenAt ? s.endedAt : prev.lastSeenAt,
    };
  }
  return totals;
}
