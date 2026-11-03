// Edge Function: send-capture-reminders
//
// Cron sweep (migration 0188, every 15 minutes) for a guided photo capture
// session that got partway (at least one photo uploaded — status
// 'in_progress') and then went quiet for 45+ minutes with nothing marking
// it done. Texts the seller a short "didn't quite get all of them" nudge
// with the same capture link, so they can pick back up. A session that was
// never opened at all (status still 'pending') is left to the existing
// AI follow-up conversation (ai-reply's PHOTO_WAIT_SYSTEM) rather than
// double-nudged here — this sweep is specifically for "started, then
// stalled," which is what "abandons the page partway" means.
//
// Same purpose-made-secret auth as send-onhold-followups/bulk-sms-
// dispatcher — not the service role key, see 0129's comment on why.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DISPATCH_SECRET = Deno.env.get('SEND_CAPTURE_REMINDERS_CRON_SECRET')!;

const ZOOM_ACCOUNT_ID = Deno.env.get('ZOOM_ACCOUNT_ID')!;
const ZOOM_CLIENT_ID = Deno.env.get('ZOOM_CLIENT_ID')!;
const ZOOM_CLIENT_SECRET = Deno.env.get('ZOOM_CLIENT_SECRET')!;

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
const STALE_MINUTES = 45;
const MAX_PER_RUN = 50;

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

// A short set rather than one fixed string — same reasoning send-onhold-
// followups documents: identical wording landing in lead after lead is
// exactly what makes an automated text read as automated. {{LINK}} is the
// same, reused session token (resuming restarts the shot list from the
// top client-side, but still gets them straight back to the camera).
const NUDGE_VARIANTS = [
  "Hey, looks like we didn't quite get all the photos, no worries! Whenever you get a sec, here's that link again: {{LINK}}",
  "Hey, the photo link seems to have gotten cut off partway, no rush at all. Here it is again whenever's good: {{LINK}}",
  "Hey, didn't catch all the photos on our end, might've lost connection partway through. Here's that link again whenever works: {{LINK}}",
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  if (req.headers.get('x-internal-secret') !== DISPATCH_SECRET) {
    return json({ error: 'Unauthorized.' }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const staleThreshold = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString();

  const { data: eligible, error: fetchErr } = await admin
    .from('photo_capture_sessions')
    .select('id, token, lead_id, leads(user_id, first_name, phone, phone_norm, opted_out, assigned_sms_number)')
    .eq('status', 'in_progress')
    .is('reminder_sent_at', null)
    .lt('last_activity_at', staleThreshold)
    .limit(MAX_PER_RUN);
  if (fetchErr) return json({ error: fetchErr.message }, 500);

  let sent = 0;
  let skipped = 0;
  const errors: { sessionId: string; error: string }[] = [];

  for (const row of eligible ?? []) {
    try {
      // Claim atomically (re-checking reminder_sent_at is still null) so two
      // overlapping sweep runs can't both text the same stalled session.
      const { data: claimed } = await admin
        .from('photo_capture_sessions')
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq('id', row.id)
        .is('reminder_sent_at', null)
        .select('id');
      if (!claimed || claimed.length === 0) {
        skipped++;
        continue;
      }

      const lead = (row as any).leads;
      if (!lead?.phone || lead.opted_out) {
        skipped++;
        continue;
      }

      const link = `https://www.bluebirdacquisition.com/crm/capture/${row.token}`;
      const message = NUDGE_VARIANTS[Math.floor(Math.random() * NUDGE_VARIANTS.length)].replace('{{LINK}}', link);
      const fromPhone = NUMBER_PHONES[lead.assigned_sms_number ?? '1'] || NUMBER_PHONES['1'];
      const toPhone = toE164(lead.phone);

      const token = await zoomToken();
      await sendZoomSms(fromPhone, toPhone, message, token);
      await admin.from('send_log').insert({
        user_id: lead.user_id,
        lead_id: row.lead_id,
        phone: toPhone,
        phone_norm: lead.phone_norm ?? toPhone.replace(/[^0-9]/g, '').slice(-10),
        sent_from: fromPhone,
        body: message,
      });
      await admin.from('lead_activities').insert({
        lead_id: row.lead_id,
        user_id: lead.user_id,
        type: 'sms',
        body: message,
        meta: { direction: 'outbound', from: fromPhone, to: toPhone, captureReminder: true },
      });

      sent++;
    } catch (e) {
      errors.push({ sessionId: row.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return json({ ok: true, sent, skipped, errors, totalEligible: (eligible ?? []).length });
});
