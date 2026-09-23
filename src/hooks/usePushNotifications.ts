import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
const SW_SCOPE = '/crm/';

/** Web Push wants the VAPID key as a raw Uint8Array, browsers hand it to
 * us (and expect it back) as base64url — same encoding used everywhere
 * else this app deals with URL-safe tokens. */
function base64UrlToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** register() resolving only means registration was accepted — the worker
 * still has to go through install → activate, and pushManager.subscribe()
 * throws ("no active Service Worker") if called before that finishes. Most
 * of the time this is instant, but on a first-ever subscribe (or right
 * after a sw.js update) the race is real, so wait for 'activated' before
 * handing the registration back. Bounded so a stuck worker fails fast
 * through subscribe()'s own error instead of hanging the mutation forever. */
function waitForActive(registration: ServiceWorkerRegistration): Promise<void> {
  if (registration.active) return Promise.resolve();
  const worker = registration.installing || registration.waiting;
  if (!worker) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 10_000);
    worker.addEventListener('statechange', function onStateChange() {
      if (worker.state === 'activated' || worker.state === 'redundant') {
        clearTimeout(timeout);
        worker.removeEventListener('statechange', onStateChange);
        resolve();
      }
    });
  });
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.register('/sw.js', { scope: SW_SCOPE });
  await waitForActive(registration);
  return registration;
}

/** Whether *this specific device/browser* already has an active push
 * subscription — deliberately not a profiles-table boolean, since a
 * subscription is inherently tied to one browser's own PushManager
 * endpoint, not the account as a whole. */
export function useDeviceSubscriptionStatus() {
  const [status, setStatus] = useState<'checking' | 'unsupported' | 'subscribed' | 'unsubscribed'>('checking');
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        if (!cancelled) setStatus('unsupported');
        return;
      }
      try {
        const registration = await navigator.serviceWorker.getRegistration(SW_SCOPE);
        const sub = await registration?.pushManager.getSubscription();
        if (!cancelled) setStatus(sub ? 'subscribed' : 'unsubscribed');
      } catch {
        if (!cancelled) setStatus('unsubscribed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [generation]);

  return { status, refresh: () => setGeneration((g) => g + 1) };
}

export function useSubscribeToPush() {
  return useMutation({
    mutationFn: async () => {
      if (!VAPID_PUBLIC_KEY) throw new Error('Push notifications are not configured for this deployment.');
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error("This browser doesn't support push notifications.");
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notification permission was not granted.');

      const registration = await getRegistration();
      if (!registration) throw new Error('Could not register the service worker.');

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(VAPID_PUBLIC_KEY),
      });

      const json = subscription.toJSON();
      const { error } = await supabase.rpc('upsert_push_subscription', {
        p_endpoint: json.endpoint,
        p_p256dh: json.keys?.p256dh,
        p_auth: json.keys?.auth,
        p_user_agent: navigator.userAgent,
      });
      if (error) throw error;
    },
  });
}

export function useUnsubscribeFromPush() {
  return useMutation({
    mutationFn: async () => {
      const registration = await navigator.serviceWorker.getRegistration(SW_SCOPE);
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) return;

      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
    },
  });
}
