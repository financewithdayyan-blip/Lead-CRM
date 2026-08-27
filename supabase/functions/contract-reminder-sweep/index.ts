// Edge Function: contract-reminder-sweep
//
// Blue Docs overhaul, phase 1c — pg_cron-driven nudge for a signer who's had
// an unlocked link sitting unsigned for a while. Never called by a browser;
// auth is the x-internal-secret header, same shape as bulk-sms-dispatcher/
// ai-reply-review (a purpose-made Vault secret, never the service-role key —
// see 0077's own comment on the format-drift risk of that older pattern).
//
// The actual "who's due" and "claim so nothing gets reminded twice" logic
// lives in claim_contract_reminders() (0091, broadened in 0116 to cover
// email-only parties) — this function's only job is running that RPC and
// sending whatever it hands back, via whichever channel(s) that party
// actually opted into at send time (send_sms/send_email), same as the
// initial invite and the next-signer nudge already do.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const INTERNAL_SECRET = Deno.env.get('CONTRACT_REMINDER_SECRET')!;

// Second delivery channel alongside Zoom SMS — see create-contract-instance's
// own comment on this; same secrets, same reasoning (10DLC blocks SMS with
// links, which is every message this function can send too).
const SMTP_HOST = Deno.env.get('SMTP_HOST')!;
const SMTP_PORT = Number(Deno.env.get('SMTP_PORT') ?? '465');
const SMTP_USER = Deno.env.get('SMTP_USER')!;
const SMTP_PASS = Deno.env.get('SMTP_PASS')!;
const SMTP_FROM_EMAIL = Deno.env.get('SMTP_FROM_EMAIL')!;
const SMTP_FROM_NAME = Deno.env.get('SMTP_FROM_NAME') ?? 'Bluebird Acquisition';

const ZOOM_ACCOUNT_ID = Deno.env.get('ZOOM_ACCOUNT_ID')!;
const ZOOM_CLIENT_ID = Deno.env.get('ZOOM_CLIENT_ID')!;
const ZOOM_CLIENT_SECRET = Deno.env.get('ZOOM_CLIENT_SECRET')!;
// Same shared-number reasoning as create-contract-instance/submit-signature
// — 217-408-2781 is NUMBERS['2'] in the outreach pool, reused here rather
// than duplicated into a separate secret pair.
const BLUEDOCS_NUMBER = {
  phone: Deno.env.get('ZOOM_FROM_NUMBER_2') ?? '',
  email: Deno.env.get('ZOOM_USER_EMAIL_2') ?? '',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const FETCH_TIMEOUT_MS = 15_000;
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

// DRAFT COPY — flagged for sign-off, same as the other Blue Docs SMS
// templates (create-contract-instance, submit-signature).
const REMINDER_MESSAGE = (name: string, docName: string, link: string) =>
  `Reminder: ${docName} is still waiting on your signature, ${name}. Sign here: ${link}`;

// ── Email (duplicated from create-contract-instance/submit-signature, not
// shared — this codebase's own established convention). A failure here must
// never fail the SMS side or another party's own reminder in the same run. ─
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
    await client.send({ from: `${SMTP_FROM_NAME} <${SMTP_FROM_EMAIL}>`, to, subject, content: 'auto', html });
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

interface ClaimedParty {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  send_sms: boolean;
  send_email: boolean;
  access_token: string;
  contract_instance_id: string;
  contract_name: string | null;
  property_address: string | null;
}

Deno.serve(async (req) => {
  if (req.headers.get('x-internal-secret') !== INTERNAL_SECRET) {
    return json({ error: 'unauthorized' }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const { data: claimed, error: claimErr } = await admin.rpc('claim_contract_reminders', { p_limit: 50 });
    if (claimErr) throw claimErr;
    if (!claimed?.length) return json({ ok: true, reminded: 0 });

    const parties = claimed as ClaimedParty[];
    const needsSms = parties.some((p) => p.send_sms && p.phone);
    if (needsSms && (!BLUEDOCS_NUMBER.phone || !BLUEDOCS_NUMBER.email)) {
      return json({ ok: false, error: 'Blue Docs sending number is not configured.' }, 500);
    }

    const token = needsSms ? await zoomToken() : null;
    if (token) await zoomUserId(BLUEDOCS_NUMBER.email, token);

    let reminded = 0;
    const failures: { id: string; error: string }[] = [];
    for (const party of parties) {
      try {
        const link = `https://www.bluebirdacquisition.com/crm/sign/${party.access_token}`;
        const docName = party.contract_name ?? 'a document';
        const address = party.property_address ?? '';
        let sentAny = false;

        if (party.send_sms && party.phone && token) {
          try {
            await sendZoomSms(BLUEDOCS_NUMBER.phone, party.phone, REMINDER_MESSAGE(party.name, docName, link), token);
            sentAny = true;
          } catch (smsErr) {
            console.error(`Reminder SMS failed for party ${party.id}:`, smsErr);
          }
        }
        if (party.send_email && party.email) {
          try {
            const html = reminderEmailHtml({ name: party.name, docName, address, link });
            await sendEmail(party.email, `Reminder: ${docName} is waiting for your signature`, html);
            sentAny = true;
          } catch (emailErr) {
            console.error(`Reminder email failed for party ${party.id}:`, emailErr);
          }
        }

        if (!sentAny) throw new Error('Both delivery attempts failed (or no usable channel).');

        await admin.from('contract_audit_events').insert({
          contract_instance_id: party.contract_instance_id,
          party_id: party.id,
          event_type: 'reminder_sent',
        });
        reminded++;
      } catch (e) {
        failures.push({ id: party.id, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return json({ ok: true, reminded, failed: failures });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unexpected error' }, 500);
  }
});
