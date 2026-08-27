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
// Sends via whichever channel(s) the party was actually invited through
// (send_sms/send_email) — same as the initial invite and the next-signer
// nudge in create-contract-instance/submit-signature. An email-only party
// (no phone on file, by design) used to get a hard "no phone number" error
// here instead of the email reminder they should have gotten.
//
// Admin-only, real logged-in session — same posture as create-contract-instance.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

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

// Second delivery channel alongside Zoom SMS — see create-contract-instance's
// own comment on this; same secrets, same reasoning.
const SMTP_HOST = Deno.env.get('SMTP_HOST')!;
const SMTP_PORT = Number(Deno.env.get('SMTP_PORT') ?? '465');
const SMTP_USER = Deno.env.get('SMTP_USER')!;
const SMTP_PASS = Deno.env.get('SMTP_PASS')!;
const SMTP_FROM_EMAIL = Deno.env.get('SMTP_FROM_EMAIL')!;
const SMTP_FROM_NAME = Deno.env.get('SMTP_FROM_NAME') ?? 'Bluebird Acquisition';

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

// ── Email (duplicated from create-contract-instance/submit-signature, not
// shared — this codebase's own established convention for the Zoom SMS
// helpers above). ────────────────────────────────────────────────────────
async function sendEmail(to: string, subject: string, html: string) {
  const client = new SMTPClient({
    connection: {
      hostname: SMTP_HOST,
      port: SMTP_PORT,
      tls: true,
      auth: { username: SMTP_USER, password: SMTP_PASS },
    },
  });
  try {
    await withTimeout(
      client.send({ from: `${SMTP_FROM_NAME} <${SMTP_FROM_EMAIL}>`, to, subject, content: 'auto', html }),
      'SMTP send',
    );
  } finally {
    await client.close();
  }
}

function emailShell(preheader: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bluebird Acquisition</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 4px rgba(11,30,51,.04),0 14px 32px -16px rgba(11,30,51,.16);">
<tr><td style="background:#0B1E33;padding:24px 32px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:28px;height:28px;background:#1568A8;border-radius:8px;text-align:center;vertical-align:middle;font-size:14px;line-height:28px;">&#9993;</td>
<td style="padding-left:10px;font-size:15px;font-weight:700;color:#ffffff;font-family:Georgia,'Times New Roman',serif;">Bluebird <span style="font-weight:500;color:#8CA0B8;">Acquisition</span></td>
</tr></table>
</td></tr>
<tr><td style="padding:32px;">${bodyHtml}</td></tr>
<tr><td style="padding:18px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
<p style="margin:0;font-size:11px;line-height:1.6;color:#8693A1;">This email was sent by Bluebird Acquisition regarding a real estate contract you're a party to. If the button above doesn't open, use the link at the bottom of this email.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function addressCallout(address: string): string {
  return `<div style="margin:20px 0;padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#8693A1;">Property</div>
<div style="margin-top:4px;font-size:14px;font-weight:600;color:#0B1E33;">${address}</div>
</div>`;
}

function ctaButton(link: string, label: string, bg: string, color: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${bg};border-radius:10px;">
<a href="${link}" style="display:inline-block;padding:14px 28px;font-size:14px;font-weight:700;color:${color};text-decoration:none;">${label}</a>
</td></tr></table>`;
}

function fallbackLink(link: string): string {
  return `<p style="margin:20px 0 0;font-size:11.5px;color:#8693A1;word-break:break-all;">Or paste this link into your browser:<br><a href="${link}" style="color:#1568A8;">${link}</a></p>`;
}

function reminderEmailHtml(opts: { name: string; docName: string; address: string; link: string }): string {
  const { name, docName, address, link } = opts;
  const body = `
<p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#C9A24B;">Reminder</p>
<h1 style="margin:6px 0 0;font-size:20px;font-weight:700;color:#0B1E33;">Hi ${name.split(' ')[0]}, we're still waiting on your signature</h1>
<p style="margin:14px 0 0;font-size:14px;line-height:1.6;color:#45566B;">${docName} is ready and waiting for you to sign. It only takes a couple of minutes.</p>
${address ? addressCallout(address) : ''}
${ctaButton(link, 'Review &amp; Sign Document', '#C9A24B', '#0B1E33')}
<p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#45566B;">Thanks so much, and looking forward to getting this wrapped up!<br>Warm regards,<br>Dayyan</p>
${fallbackLink(link)}`;
  return emailShell(`Reminder: ${docName} is still waiting on your signature`, body);
}

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

    const canSms = party.send_sms && !!party.phone;
    const canEmail = party.send_email && !!party.email;
    if (!canSms && !canEmail) {
      return json({ error: 'This party has no usable delivery method (SMS or email) on file.' }, 400);
    }

    const { data: instance, error: instErr } = await withTimeout(
      admin.from('contract_instances').select('status, name, property_address').eq('id', party.contract_instance_id).single(),
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

    if (canSms && (!BLUEDOCS_NUMBER.phone || !BLUEDOCS_NUMBER.email)) {
      return json({ error: 'Blue Docs sending number is not configured yet.' }, 500);
    }

    const link = `https://www.bluebirdacquisition.com/crm/sign/${party.access_token}`;
    const docName = instance.name ?? 'the document';
    const address = instance.property_address ?? '';
    let sentAny = false;
    const errors: string[] = [];

    if (canSms) {
      try {
        const token = await withTimeout(zoomToken(), 'Zoom auth');
        await withTimeout(zoomUserId(BLUEDOCS_NUMBER.email, token), 'Zoom user lookup');
        await withTimeout(sendZoomSms(BLUEDOCS_NUMBER.phone, party.phone, REMINDER_MESSAGE(party.name, link), token), 'Zoom send');
        sentAny = true;
      } catch (smsErr) {
        errors.push(smsErr instanceof Error ? smsErr.message : String(smsErr));
      }
    }
    if (canEmail) {
      try {
        const html = reminderEmailHtml({ name: party.name, docName, address, link });
        await sendEmail(party.email, `Reminder: ${docName} is waiting for your signature`, html);
        sentAny = true;
      } catch (emailErr) {
        errors.push(emailErr instanceof Error ? emailErr.message : String(emailErr));
      }
    }

    if (!sentAny) {
      return json({ error: `Failed to send reminder: ${errors.join('; ')}` }, 502);
    }

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
