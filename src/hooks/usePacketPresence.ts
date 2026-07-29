import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getViewerToken } from '@/lib/viewerToken';

const channelName = (packetId: string) => `packet-presence:${packetId}`;

/**
 * Admin side: how many people have the packet open right now.
 *
 * Subscribes without calling track(), so an admin watching the analytics panel
 * is a listener rather than a viewer and never counts itself.
 */
export function usePacketLiveViewers(packetId: string | undefined) {
  const [liveCount, setLiveCount] = useState(0);

  useEffect(() => {
    if (!packetId) return;
    const channel = supabase.channel(channelName(packetId));

    channel
      .on('presence', { event: 'sync' }, () => {
        setLiveCount(Object.keys(channel.presenceState()).length);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      setLiveCount(0);
    };
  }, [packetId]);

  return liveCount;
}

/**
 * Public side: announce this viewer while the packet page is open. Keyed on the
 * viewer token so two tabs from the same browser count once, and cleaned up on
 * unmount so the count falls as people leave.
 */
export function useAnnouncePacketPresence(packetId: string | undefined, enabled: boolean) {
  useEffect(() => {
    if (!packetId || !enabled) return;
    const channel = supabase.channel(channelName(packetId), {
      config: { presence: { key: getViewerToken() } },
    });

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        channel.track({ at: new Date().toISOString() });
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [packetId, enabled]);
}
