// Edge Function: complete-capture-session
//
// Called once, when the seller finishes (or explicitly ends) the guided
// photo capture flow. Public/unauthenticated like submit-capture-photo —
// same token-as-credential model. Marks the session done, drops a
// notification for the agent who owns the lead (lc_notifications — the
// same table the bell icon already reads), and texts the seller a short
// confirmation so they know the photos actually made it through rather
// than wondering if the page "worked."
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ZOOM_ACCOUNT_ID = Deno.env.get('ZOOM_ACCOUNT_ID')!;
const ZOOM_CLIENT_ID = Deno.env.get('ZOOM_CLIENT_ID')!;
const ZOOM_CLIENT_SECRET = Deno.env.get('ZOOM_CLIENT_SECRET')!;

// Phone only — mirrors the same slots in send-sms/ai-reply (each function
// keeps its own copy rather than sharing a module, see ai-reply's own note
// on this). Only the phone is actually used by sendZoomSms below.
const NUMBER_PHONES: Record<string, string> = {
  '1': Deno.env.get('ZOOM_FROM_NUMBER') ?? '',
  '2': Deno.env.get('ZOOM_FROM_NUMBER_2') ?? '',
  '3': Deno.env.get('ZOOM_FROM_NUMBER_3') ?? '',
  '4': Deno.env.get('ZOOM_FROM_NUMBER_4') ?? '',
  '5': Deno.env.get('ZOOM_FROM_NUMBER_5') ?? '',
  '6': Deno.env.get('ZOOM_FROM_NUMBER_6') ?? '',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

const FETCH_TIMEOUT_MS = 15_000;

let cachedToken: { token: string; expiresAt: number } | null = null;

async function zoomToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;
  const basic = btoa(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`);
  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(ZOOM_ACCOUNT_ID)}`,
    { method: 'POST', headers: { Authorization: `Basic ${basic}` }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
  );
  if (!res.ok) throw new Error(`Zoom auth failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000 };
  return cachedToken.token;
}

async function sendZoomSms(fromPhone: string, toPhone: string, message: string, token: string) {
  const res = await fetch('https://api.zoom.us/v2/phone/sms/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender: { phone_number: fromPhone }, to_members: [{ phone_number: toPhone }], message }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Zoom send failed (${res.status}): ${await res.text()}`);
}

function toE164(raw: string): string {
  const digits = (raw ?? '').replace(/[^0-9]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return raw?.startsWith('+') ? raw : `+${digits}`;
}

// A short set rather than one fixed string, same reasoning send-onhold-
// followups documents for its own texts: identical wording landing in
// conversation after conversation is what makes an automated text actually
// read as automated.
const THANKS_VARIANTS = [
  "Thank you so much, got all your photos! Really appreciate it 🙌",
  "Awesome, photos are all in, thank you! We'll take it from here.",
  "Got them, thanks so much for taking the time to do that!",
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const { token } = await req.json();
    if (!token) return json({ error: 'Missing token' }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: session, error: sessionErr } = await admin
      .from('photo_capture_sessions')
      .select('id, lead_id, photos_count, leads(user_id, first_name, last_name, phone, phone_norm, opted_out, assigned_sms_number)')
      .eq('token', token)
      .maybeSingle();
    if (sessionErr) throw sessionErr;
    if (!session) return json({ error: 'Capture link not found' }, 404);

    const { error: updateErr } = await admin
      .from('photo_capture_sessions')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', session.id);
    if (updateErr) throw updateErr;

    const lead = (session as any).leads;

    if (lead?.user_id) {
      const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'A seller';
      await admin.from('lc_notifications').insert({
        user_id: lead.user_id,
        lead_id: session.lead_id,
        type: 'photo_capture_completed',
        title: 'Photos received',
        body: `${name} finished the guided photo capture — ${session.photos_count} photo${session.photos_count === 1 ? '' : 's'} uploaded.`,
      });
    }

    // Best-effort — the photos are already safely in regardless of whether
    // this confirmation text actually goes out. Same opt-out guard every
    // other automated send in this app respects.
    if (lead?.phone && !lead.opted_out) {
      try {
        const fromPhone = NUMBER_PHONES[lead.assigned_sms_number ?? '1'] || NUMBER_PHONES['1'];
        const message = THANKS_VARIANTS[Math.floor(Math.random() * THANKS_VARIANTS.length)];
        const tok = await zoomToken();
        await sendZoomSms(fromPhone, toE164(lead.phone), message, tok);
        await Promise.all([
          admin.from('send_log').insert({
            user_id: lead.user_id,
            lead_id: session.lead_id,
            phone: lead.phone,
            phone_norm: lead.phone_norm,
            sent_from: fromPhone,
            body: message,
          }),
          admin.from('lead_activities').insert({
            lead_id: session.lead_id,
            user_id: lead.user_id,
            type: 'sms',
            body: message,
            meta: { direction: 'outbound', from: fromPhone, to: lead.phone },
          }),
        ]);
      } catch (e) {
        console.error('capture confirmation SMS failed:', e);
      }
    }

    return json({ ok: true, photosCount: session.photos_count });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unexpected error' }, 500);
  }
});
