// Edge Function: send-buyer-sms
//
// A single manual text to one cash buyer. Deliberately not routed through
// send-sms: that function's bulk-splitting, daily-limit and sending-window
// machinery exists for cold outreach to leads, none of which applies here —
// a buyer text is always a one-off, always admin-initiated, never cold.
//
// Reuses the same Zoom Phone call shape and the same 6-number sending pool
// as send-sms so buyer texts go out over the same infrastructure, just
// logged to buyer_messages instead of lead_activities/send_log.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.101.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const ZOOM_ACCOUNT_ID = Deno.env.get('ZOOM_ACCOUNT_ID')!;
const ZOOM_CLIENT_ID = Deno.env.get('ZOOM_CLIENT_ID')!;
const ZOOM_CLIENT_SECRET = Deno.env.get('ZOOM_CLIENT_SECRET')!;

const NUMBERS: Record<string, { phone: string; email: string }> = {
  '1': { phone: Deno.env.get('ZOOM_FROM_NUMBER') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL') ?? '' },
  '2': { phone: Deno.env.get('ZOOM_FROM_NUMBER_2') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL_2') ?? '' },
  '3': { phone: Deno.env.get('ZOOM_FROM_NUMBER_3') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL_3') ?? '' },
  '4': { phone: Deno.env.get('ZOOM_FROM_NUMBER_4') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL_4') ?? '' },
  '5': { phone: Deno.env.get('ZOOM_FROM_NUMBER_5') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL_5') ?? '' },
  '6': { phone: Deno.env.get('ZOOM_FROM_NUMBER_6') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL_6') ?? '' },
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

const FETCH_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timed out waiting on ${label}`)), FETCH_TIMEOUT_MS)),
  ]);
}

async function zoomFetch(url: string, options: RequestInit, maxRetries = 4): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), ...options });
    if (res.status !== 429 || attempt >= maxRetries) return res;
    const retryAfterSec = Number(res.headers.get('Retry-After'));
    const backoffMs = (Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : 500 * 2 ** attempt) + Math.random() * 250;
    await res.body?.cancel().catch(() => {});
    await new Promise((r) => setTimeout(r, backoffMs));
  }
}

async function zoomToken(): Promise<string> {
  const basic = btoa(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`);
  const res = await zoomFetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(ZOOM_ACCOUNT_ID)}`,
    { method: 'POST', headers: { Authorization: `Basic ${basic}` } },
  );
  if (!res.ok) throw new Error(`Zoom auth failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

async function zoomUserId(email: string, token: string): Promise<string> {
  const res = await zoomFetch(`https://api.zoom.us/v2/users/${encodeURIComponent(email)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Zoom user lookup failed for ${email} (${res.status}): ${await res.text()}`);
  return (await res.json()).id;
}

async function sendZoomSms(fromPhone: string, toPhone: string, message: string, token: string) {
  const res = await zoomFetch('https://api.zoom.us/v2/phone/sms/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender: { phone_number: fromPhone }, to_members: [{ phone_number: toPhone }], message }),
  });
  if (!res.ok) throw new Error(`Zoom send failed (${res.status}): ${await res.text()}`);
}

/** E.164 for Zoom. Ten digits get a US country code; eleven starting with 1 already have one. */
function toE164(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await withTimeout(callerClient.auth.getUser(), 'auth.getUser()');
    const userId = userData?.user?.id;
    if (!userId) return json({ error: 'Not signed in.' }, 401);

    const { data: profile } = await withTimeout(
      admin.from('profiles').select('role').eq('id', userId).single().abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
      'profile lookup',
    );
    if (profile?.role !== 'admin') return json({ error: 'Admins only.' }, 403);

    const { buyerId, body, fromKey } = await req.json();
    if (!buyerId || typeof body !== 'string' || !body.trim()) return json({ error: 'buyerId and a non-empty body are required.' }, 400);

    const { data: buyer } = await withTimeout(
      admin.from('cash_buyers').select('id, phone, sms_opted_out, assigned_sms_number').eq('id', buyerId).single()
        .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
      'buyer lookup',
    );
    if (!buyer) return json({ error: 'Buyer not found.' }, 404);
    if (buyer.sms_opted_out) return json({ error: 'This buyer opted out — sending is disabled.' }, 422);
    if (!buyer.phone) return json({ error: 'This buyer has no phone number on file.' }, 400);

    const toPhone = toE164(buyer.phone);
    if (!toPhone) return json({ error: 'Buyer phone number is not a valid US number.' }, 400);

    // Same "pinned number wins" rule as leads — a buyer's whole thread stays
    // on one Zoom number once it has one, regardless of what's picked here.
    const pinned = buyer.assigned_sms_number as string | null;
    const effectiveKey = pinned && NUMBERS[pinned]?.phone ? pinned : fromKey;
    const sender = NUMBERS[effectiveKey];
    if (!sender?.phone || !sender.email) return json({ error: `Sending number "${effectiveKey}" is not configured.` }, 400);

    const token = await withTimeout(zoomToken(), 'Zoom auth');
    await withTimeout(zoomUserId(sender.email, token), 'Zoom user lookup');
    await withTimeout(sendZoomSms(sender.phone, toPhone, body.trim(), token), 'Zoom send');

    await withTimeout(
      admin.from('buyer_messages').insert({
        buyer_id: buyerId,
        direction: 'outbound',
        body: body.trim(),
        from_phone: sender.phone,
        to_phone: toPhone,
        sent_from: effectiveKey,
        user_id: userId,
      }).abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
      'buyer_messages insert',
    );

    if (!pinned) {
      await withTimeout(
        admin.from('cash_buyers').update({ assigned_sms_number: effectiveKey }).eq('id', buyerId)
          .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
        'pin assigned_sms_number',
      );
    }

    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
