import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from './AuthContext';

export type UserStatus = 'online' | 'session';

interface PresenceContextValue {
  onlineIds: Set<string>;
  statusMap: Record<string, UserStatus>;
  setMyStatus: (status: UserStatus) => void;
}

const PresenceContext = createContext<PresenceContextValue>({
  onlineIds: new Set(),
  statusMap: {},
  setMyStatus: () => {},
});

export function PresenceProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [statusMap, setStatusMap] = useState<Record<string, UserStatus>>({});
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const myStatusRef = useRef<UserStatus>('online');

  useEffect(() => {
    if (!userId) {
      setOnlineIds(new Set());
      setStatusMap({});
      return;
    }

    const channel = supabase.channel('presence:online', {
      config: { presence: { key: userId } },
    });
    channelRef.current = channel;

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<{ online_at: string; status?: UserStatus }>();
        const ids = new Set(Object.keys(state));
        const map: Record<string, UserStatus> = {};
        for (const [uid, payloads] of Object.entries(state)) {
          map[uid] = payloads[0]?.status ?? 'online';
        }
        setOnlineIds(ids);
        setStatusMap(map);
      })
      .subscribe((sub) => {
        if (sub === 'SUBSCRIBED') {
          channel.track({ online_at: new Date().toISOString(), status: myStatusRef.current });
        }
      });

    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const setMyStatus = useCallback((status: UserStatus) => {
    myStatusRef.current = status;
    channelRef.current?.track({ online_at: new Date().toISOString(), status });
  }, []);

  return (
    <PresenceContext.Provider value={{ onlineIds, statusMap, setMyStatus }}>
      {children}
    </PresenceContext.Provider>
  );
}

export function useOnlineUserIds() {
  return useContext(PresenceContext).onlineIds;
}

export function usePresence() {
  return useContext(PresenceContext);
}
