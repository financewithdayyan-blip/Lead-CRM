import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { dbToCallingSession } from '@/lib/mappers';
import { useAuth } from '@/contexts/AuthContext';
import type { CallingSession } from '@/types/domain';
import { localIsoDate } from '@/lib/utils';

/** Recent calling session history for one user, newest first - powers the detailed attendance log on their team card. */
export function useAttendanceSessions(userId: string | undefined) {
  return useQuery({
    queryKey: ['calling_sessions', userId],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 14);
      const { data, error } = await supabase
        .from('calling_sessions')
        .select('*')
        .eq('user_id', userId)
        .gte('started_at', since.toISOString())
        .order('started_at', { ascending: false });
      if (error) throw error;
      return data.map(dbToCallingSession);
    },
    enabled: !!userId,
  });
}

/** Today's calling_sessions rows across the whole team - used for the Team page attendance badges. */
export function useTeamTodaySessions() {
  const { session, profile } = useAuth();
  const ownerId = session?.user.id;
  const todayIso = localIsoDate(new Date());
  return useQuery({
    queryKey: ['calling_sessions', 'team_today', ownerId, todayIso],
    queryFn: async () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from('calling_sessions')
        .select('*')
        .gte('started_at', start.toISOString())
        .neq('user_id', ownerId);
      if (error) throw error;
      return data.map(dbToCallingSession);
    },
    enabled: !!ownerId && profile?.role === 'admin',
    refetchInterval: 60_000,
  });
}

/** Last 7 days of calling_sessions across the whole team - used by the Notifications page. */
export function useTeamWeeklySessions() {
  const { session, profile } = useAuth();
  const ownerId = session?.user.id;
  return useQuery({
    queryKey: ['calling_sessions', 'team_weekly', ownerId],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 7);
      since.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from('calling_sessions')
        .select('*')
        .gte('started_at', since.toISOString())
        .neq('user_id', ownerId)
        .order('started_at', { ascending: false });
      if (error) throw error;
      return data.map(dbToCallingSession);
    },
    enabled: !!ownerId && profile?.role === 'admin',
    refetchInterval: 60_000,
  });
}

export interface TodayAttendance {
  seconds: number;
  lastSeenAt: string;
}

/** Reduces today's calling sessions into a per-member session total + last-seen time. Open sessions (endedAt = null) count up to now. */
export function aggregateTodayAttendance(sessions: CallingSession[]): Record<string, TodayAttendance> {
  const now = new Date().toISOString();
  const totals: Record<string, TodayAttendance> = {};
  for (const s of sessions) {
    const end = s.endedAt ?? now;
    const seconds = Math.max(0, (new Date(end).getTime() - new Date(s.startedAt).getTime()) / 1000);
    const prev = totals[s.userId];
    totals[s.userId] = {
      seconds: (prev?.seconds ?? 0) + seconds,
      lastSeenAt: !prev || end > prev.lastSeenAt ? end : prev.lastSeenAt,
    };
  }
  return totals;
}
