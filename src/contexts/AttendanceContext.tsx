import { useEffect, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from './AuthContext';

const HEARTBEAT_MS = 60_000;
// A reload/tab-switch within this window resumes the same session row
// instead of fragmenting attendance into a new one every refresh.
const RESUME_WINDOW_MS = 5 * 60_000;

// No UI - clocks the user in/out in the background so useAttendance.ts has data to show admins.
export function AttendanceProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id;

  useEffect(() => {
    if (!userId) return;
    let sessionRowId: string | null = null;
    let cancelled = false;

    async function bump() {
      if (!sessionRowId) return;
      await supabase.from('attendance_sessions').update({ ended_at: new Date().toISOString() }).eq('id', sessionRowId);
    }

    async function start() {
      const { data: recent } = await supabase
        .from('attendance_sessions')
        .select('id, ended_at')
        .eq('user_id', userId)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;

      if (recent && Date.now() - new Date(recent.ended_at).getTime() < RESUME_WINDOW_MS) {
        sessionRowId = recent.id;
        bump();
        return;
      }

      const { data } = await supabase.from('attendance_sessions').insert({ user_id: userId }).select('id').single();
      if (!cancelled) sessionRowId = data?.id ?? null;
    }

    start();
    const interval = setInterval(bump, HEARTBEAT_MS);
    window.addEventListener('beforeunload', bump);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('beforeunload', bump);
      bump();
    };
  }, [userId]);

  return <>{children}</>;
}
