// Edge Function: send-contract-reminder
//
// Manual, on-demand nudge for a single pending signing party — triggered by
// an admin clicking "Send Reminder" on an envelope in the Blue Docs UI.
// Distinct from contract-reminder-sweep (pg_cron, every 30 min, gated by its
// own 24h/72h cadence + 3-reminder cap via claim_contract_reminders): this
// bypasses that cadence entirely since an admin asking for it right now is
// a deliberate action, not something that should silently no-op just
// because it isn't "due" yet. It still writes to the same
// reminder_count/last_reminded_at columns the automatic sweep reads, so a
// manual send here also resets the sweep's own cadence clock instead of
// risking a duplicate automatic reminder minutes later.
//
// Admin-only, real logged-in session — same posture as create-contract-instance.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const ZOOM_ACCOUNT_ID = Deno.env.get('ZOOM_ACCOUNT_ID')!;
const ZOOM_CLIENT_ID = Deno.env.get('ZOOM_CLIENT_ID')!;
const ZOOM_CLIENT_SECRET = Deno.env.get('ZOOM_CLIENT_SECRET')!;
// Same shared-number reasoning as create-contract-instance/submit-signature.
const BLUEDOCS_NUMBER = {
  phone: Deno.env.get('ZOOM_FROM_NUMBER_2') ?? '',
  email: Deno.env.get('ZOOM_USER_EMAIL_2') ?? '',
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

// ── Zoom sending (duplicated, not shared — this codebase's own established
// convention, see create-contract-instance/submit-signature/contract-reminder-sweep). ──
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let cachedToken: { token: string; expiresAt: number } | null = null;

async function zoomFetch(url: string, options: RequestInit, maxRetries = 4): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), ...options });
    if (res.status !== 429 || attempt >= maxRetries) return res;
    const retryAfterSec = Number(res.headers.get('Retry-After'));
    const backoffMs = (Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : 500 * 2 ** attempt) + Math.random() * 250;
    await res.body?.cancel().catch(() => {});
    await sleep(backoffMs);
  }
}

async function zoomToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;
  const basic = btoa(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`);
  const res = await zoomFetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(ZOOM_ACCOUNT_ID)}`,
    { method: 'POST', headers: { Authorization: `Basic ${basic}` } },
  );
  if (!res.ok) throw new Error(`Zoom auth failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000 };
  return cachedToken.token;
}

async function zoomUserId(email: string, token: string): Promise<string> {
  const res = await zoomFetch(`https://api.zoom.us/v2/users/${encodeURIComponent(email)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Zoom user lookup failed for ${email} (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.id as string;
}

async function sendZoomSms(fromPhone: string, toPhone: string, message: string, token: string) {
  const res = await zoomFetch('https://api.zoom.us/v2/phone/sms/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender: { phone_number: fromPhone }, to_members: [{ phone_number: toPhone }], message }),
  });
  if (!res.ok) throw new Error(`Zoom send failed (${res.status}): ${await res.text()}`);
  return res.json().catch(() => ({}));
}

const REMINDER_MESSAGE = (name: string, link: string) =>
  `Hi ${name},\nI hope you're doing well! This is a friendly reminder that we're still waiting on your signature. Please use the link below to complete it at your earliest convenience\n${link}\nThanks so much, and looking forward to getting this wrapped up!\nWarm regards,\nDayyan`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });

    const { data: userData } = await withTimeout(callerClient.auth.getUser(), 'auth.getUser()');
    if (!userData?.user?.id) return json({ error: 'Not signed in.' }, 401);

    const { data: profile } = await withTimeout(
      admin.from('profiles').select('role').eq('id', userData.user.id).single(),
      'profile lookup',
    );
    if (profile?.role !== 'admin') return json({ error: 'Admins only.' }, 403);

    const { partyId } = (await req.json()) as { partyId?: string };
    if (!partyId) return json({ error: 'Missing partyId.' }, 400);

    const { data: party, error: partyErr } = await withTimeout(
      admin.from('contract_signing_parties').select('*').eq('id', partyId).single(),
      'party lookup',
    );
    if (partyErr) throw partyErr;
    if (!party) return json({ error: 'Party not found.' }, 404);
    if (party.status !== 'pending') return json({ error: 'This party has already signed or declined.' }, 409);
    if (!party.phone) return json({ error: 'This party has no phone number on file.' }, 400);

    const { data: instance, error: instErr } = await withTimeout(
      admin.from('contract_instances').select('status').eq('id', party.contract_instance_id).single(),
      'instance lookup',
    );
    if (instErr) throw instErr;
    if (!['sent', 'partial'].includes(instance.status)) {
      return json({ error: 'This envelope is not currently awaiting signatures.' }, 409);
    }

    // Only the currently-unlocked party (no earlier sign_order still
    // pending) can actually open and complete their link — reminding
    // anyone else would be a misleading "we're waiting on you" text sent
    // before it's genuinely their turn.
    const { data: earlierPending } = await withTimeout(
      admin
        .from('contract_signing_parties')
        .select('id')
        .eq('contract_instance_id', party.contract_instance_id)
        .lt('sign_order', party.sign_order)
        .neq('status', 'signed')
        .limit(1),
      'earlier-parties lookup',
    );
    if (earlierPending?.length) {
      return json({ error: "It isn't this party's turn to sign yet." }, 409);
    }

    if (!BLUEDOCS_NUMBER.phone || !BLUEDOCS_NUMBER.email) {
      return json({ error: 'Blue Docs sending number is not configured yet.' }, 500);
    }

    const link = `https://www.bluebirdacquisition.com/crm/sign/${party.access_token}`;
    const token = await withTimeout(zoomToken(), 'Zoom auth');
    await withTimeout(zoomUserId(BLUEDOCS_NUMBER.email, token), 'Zoom user lookup');
    await withTimeout(sendZoomSms(BLUEDOCS_NUMBER.phone, party.phone, REMINDER_MESSAGE(party.name, link), token), 'Zoom send');

    await admin
      .from('contract_signing_parties')
      .update({ reminder_count: (party.reminder_count ?? 0) + 1, last_reminded_at: new Date().toISOString() })
      .eq('id', party.id);
    await admin.from('contract_audit_events').insert({
      contract_instance_id: party.contract_instance_id,
      party_id: party.id,
      event_type: 'reminder_sent',
    });

    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unexpected error' }, 500);
  }
});
