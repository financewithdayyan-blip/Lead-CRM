// Edge Function: send-push-notification
//
// Called by DB triggers (lc_notifications, web_leads — see
// 0144_push_notification_triggers.sql), never directly by the browser.
// Guarded by a shared secret (x-internal-secret), same posture as
// trigger-blog-deploy — the caller is Postgres via pg_net, not a browser,
// so there's no JWT to verify.
//
// Looks up every push_subscriptions row for the target user and sends to
// each independently — one dead/invalid subscription (404/410 from the
// push service) never blocks another device's notification, same "each
// send wrapped individually" idiom as submit-signature's completion loop.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const INTERNAL_SECRET = Deno.env.get('PUSH_NOTIFICATION_TRIGGER_SECRET')!;

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT')!;

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

// Push payloads have a practical size ceiling, and lc_notifications.body
// already carries external-controlled free text in places (a signer's
// typed decline reason, a raw inbound SMS body) — truncate defensively so
// one long message never risks a rejected payload.
const MAX_BODY_LENGTH = 200;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  if (req.headers.get('x-internal-secret') !== INTERNAL_SECRET) {
    return json({ error: 'unauthorized' }, 401);
  }

  try {
    const { user_id, title, body, url } = (await req.json()) as {
      user_id: string;
      title: string;
      body?: string | null;
      url?: string | null;
    };
    if (!user_id || !title) return json({ error: 'Missing user_id or title.' }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: subscriptions, error } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', user_id);
    if (error) throw error;
    if (!subscriptions?.length) return json({ ok: true, sent: 0 });

    const truncatedBody = (body ?? '').slice(0, MAX_BODY_LENGTH);
    const payload = JSON.stringify({ title, body: truncatedBody, url: url ?? '/crm/notifications' });

    let sent = 0;
    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        sent++;
      } catch (e) {
        const statusCode = (e as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Push service says this subscription is gone for good — prune it.
          await admin.from('push_subscriptions').delete().eq('id', sub.id);
        } else {
          console.error(`push send failed for subscription ${sub.id}:`, e);
        }
      }
    }

    return json({ ok: true, sent, total: subscriptions.length });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unexpected error' }, 500);
  }
});
