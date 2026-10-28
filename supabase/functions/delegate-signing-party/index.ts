// Edge Function: delegate-signing-party
//
// Public/unauthenticated, same posture as submit-signature — the
// access_token embedded in the caller's own signing link is the credential,
// not a login. Lets a seller-side party who ISN'T actually the seller (a
// realtor, an attorney representing them) hand their signing turn off to
// the real signer instead of completing it themselves. Seller-only by
// design — role must be 'seller' or 'seller_2'; buyer-side delegation is
// never offered anywhere in the product, there's no legitimate version of
// that scenario here.
//
// Reassigns the SAME party row in place (name/phone/email overwritten to
// the real signer's info, the intermediary's own original contact info
// preserved in delegated_from_*) rather than inserting a second row for the
// role — every other part of this flow (submit-signature, update-contract-
// instance) assumes exactly one row per role. A fresh access_token is
// issued in the same update, which is what actually invalidates the
// intermediary's own old link: get_signing_party only ever matches an exact
// token, so the old UUID simply stops resolving to anything the moment it's
// overwritten — same experience as any other dead link, no separate
// "already delegated" state needed anywhere.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const SMTP_HOST = Deno.env.get('SMTP_HOST')!;
const SMTP_PORT = Number(Deno.env.get('SMTP_PORT') ?? '465');
const SMTP_USER = Deno.env.get('SMTP_USER')!;
const SMTP_PASS = Deno.env.get('SMTP_PASS')!;
const SMTP_FROM_EMAIL = Deno.env.get('SMTP_FROM_EMAIL')!;
const SMTP_FROM_NAME = Deno.env.get('SMTP_FROM_NAME') ?? 'Bluebird Acquisition';

const ZOOM_ACCOUNT_ID = Deno.env.get('ZOOM_ACCOUNT_ID')!;
const ZOOM_CLIENT_ID = Deno.env.get('ZOOM_CLIENT_ID')!;
const ZOOM_CLIENT_SECRET = Deno.env.get('ZOOM_CLIENT_SECRET')!;
// Same Blue Docs sending identity every other contract email/SMS in this
// product uses — see create-contract-instance's own comment on this number.
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

function toE164(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

function isValidEmail(raw: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw.trim());
}

function isSellerSide(role: string): boolean {
  return role === 'seller' || role.startsWith('seller_');
}

// ── Zoom SMS (duplicated from submit-signature/create-contract-instance,
// not shared — this codebase's own established convention). ───────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let cachedZoomToken: { token: string; expiresAt: number } | null = null;

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
  if (cachedZoomToken && Date.now() < cachedZoomToken.expiresAt) return cachedZoomToken.token;
  const basic = btoa(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`);
  const res = await zoomFetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(ZOOM_ACCOUNT_ID)}`,
    { method: 'POST', headers: { Authorization: `Basic ${basic}` } },
  );
  if (!res.ok) throw new Error(`Zoom auth failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  cachedZoomToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000 };
  return cachedZoomToken.token;
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
}

async function sendBlueDocsSms(toPhone: string, message: string) {
  const token = await zoomToken();
  await zoomUserId(BLUEDOCS_NUMBER.email, token);
  await sendZoomSms(BLUEDOCS_NUMBER.phone, toPhone, message, token);
}

const NEXT_SIGNER_MESSAGE = (docName: string, address: string, link: string) =>
  `Hey, this ${docName} contract for the property\n${address}\nhas been forwarded to you to sign\n${link}\nThanks,\nDayyan`;

// ── Email (duplicated, same reasoning). ─────────────────────────────────────
async function sendEmail(to: string, subject: string, html: string) {
  const client = new SMTPClient({
    connection: { hostname: SMTP_HOST, port: SMTP_PORT, tls: true, auth: { username: SMTP_USER, password: SMTP_PASS } },
  });
  try {
    await client.send({ from: `${SMTP_FROM_NAME} <${SMTP_FROM_EMAIL}>`, to, subject, content: 'auto', html });
  } finally {
    await client.close();
  }
}

const AGENT_NAME = 'Dayyan';
function formatPhoneDisplay(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '').slice(-10);
  if (digits.length !== 10) return raw;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
const AGENT_PHONE_DISPLAY = formatPhoneDisplay(BLUEDOCS_NUMBER.phone);

function shortRef(documentId: string): string {
  return documentId.slice(0, 8).toUpperCase();
}

function emailShell(preheader: string, bodyHtml: string, opts: { documentId: string; footerNote: string }): string {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bluebird Acquisition</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 4px rgba(11,30,51,.04),0 14px 32px -16px rgba(11,30,51,.16);">
<tr><td style="padding:22px 32px;border-bottom:1px solid #e2e8f0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:10px;height:10px;background:#0B1E33;border-radius:2px;"></td>
<td style="padding-left:8px;font-size:14px;font-weight:700;color:#0B1E33;">Bluebird Acquisition</td>
</tr></table>
</td>
<td align="right" style="vertical-align:middle;font-size:11px;color:#8693A1;">Ref: ${shortRef(opts.documentId)}</td>
</tr></table>
</td></tr>
<tr><td style="padding:32px;">${bodyHtml}</td></tr>
<tr><td style="padding:18px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
<p style="margin:0 0 4px;font-size:11px;line-height:1.6;color:#8693A1;">Bluebird Acquisition &middot; Serving New York, New Jersey and Connecticut</p>
<p style="margin:0;font-size:11px;line-height:1.6;color:#8693A1;">${opts.footerNote}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function detailTable(rows: Array<{ label: string; value: string }>): string {
  const rowsHtml = rows
    .map(
      (r) => `
<tr>
<td style="padding:10px 0;border-top:1px solid #e2e8f0;font-size:12.5px;color:#8693A1;">${r.label}</td>
<td style="padding:10px 0;border-top:1px solid #e2e8f0;font-size:13px;font-weight:600;color:#0B1E33;text-align:right;">${r.value}</td>
</tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border-bottom:1px solid #e2e8f0;">${rowsHtml}</table>`;
}

function ctaButton(link: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#0B1E33;border-radius:10px;">
<a href="${link}" style="display:inline-block;padding:14px 28px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">${label}</a>
</td></tr></table>`;
}

function fallbackLink(link: string): string {
  return `<p style="margin:20px 0 0;font-size:11.5px;color:#8693A1;word-break:break-all;">Button not working? Copy this link into your browser:<br><a href="${link}" style="color:#1568A8;">${link}</a></p>`;
}

function delegatedToEmailHtml(opts: { recipientName: string; docName: string; address: string; link: string; documentId: string }): string {
  const { recipientName, docName, address, link, documentId } = opts;
  const firstName = recipientName.split(' ')[0];
  const body = `
<p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#1568A8;">Ready for your signature</p>
<h1 style="margin:0;font-size:21px;line-height:1.35;font-weight:700;color:#0B1E33;">Your ${docName} for ${address}</h1>
<p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:#45566B;">Hi ${firstName},</p>
<p style="margin:10px 0 0;font-size:14px;line-height:1.6;color:#45566B;">This has been forwarded to you to review and sign directly — it only takes a few minutes.</p>
${detailTable([{ label: 'Property', value: address }])}
${ctaButton(link, 'Review and sign')}
<p style="margin:24px 0 0;font-size:13.5px;line-height:1.6;color:#45566B;">Questions before you sign? Call me directly at ${AGENT_PHONE_DISPLAY} or just reply to this email.</p>
<p style="margin:18px 0 0;font-size:13.5px;line-height:1.6;color:#0B1E33;font-weight:600;">${AGENT_NAME}<br><span style="font-weight:400;color:#8693A1;">Acquisitions, Bluebird Acquisition</span></p>
${fallbackLink(link)}`;
  return emailShell(`${docName} was forwarded to you for your signature`, body, {
    documentId,
    footerNote: `We will never ask for bank details or payment by email. If something looks off, call ${AGENT_PHONE_DISPLAY} before signing.`,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const body = await req.json();
    const { token, newName, newPhone, newEmail, sendSms, sendEmail: sendEmailFlag } = body as {
      token: string;
      newName: string;
      newPhone?: string;
      newEmail?: string;
      sendSms: boolean;
      sendEmail: boolean;
    };
    if (!token) return json({ error: 'Missing signing link.' }, 400);
    if (!newName?.trim()) return json({ error: "Enter the actual signer's name." }, 400);
    if (!sendSms && !sendEmailFlag) return json({ error: 'Choose at least one way to reach them.' }, 400);

    let e164: string | null = null;
    if (sendSms) {
      e164 = toE164(newPhone ?? '');
      if (!e164) return json({ error: 'Enter a valid phone number to text them.' }, 400);
    }
    let emailNormalized: string | null = null;
    if (sendEmailFlag) {
      const trimmed = (newEmail ?? '').trim();
      if (!isValidEmail(trimmed)) return json({ error: 'Enter a valid email address to email them.' }, 400);
      emailNormalized = trimmed;
    }

    const { data: party, error: partyErr } = await admin
      .from('contract_signing_parties')
      .select('*')
      .eq('access_token', token)
      .maybeSingle();
    if (partyErr) throw partyErr;
    if (!party) return json({ error: 'Signing link not found.' }, 404);
    if (!isSellerSide(party.role)) return json({ error: 'This can only be forwarded for the seller.' }, 400);
    if (party.status === 'signed') return json({ error: 'This has already been signed — it can no longer be forwarded.' }, 409);

    const { data: instance, error: instErr } = await admin
      .from('contract_instances')
      .select('id, name, property_address, status')
      .eq('id', party.contract_instance_id)
      .single();
    if (instErr || !instance) throw instErr ?? new Error('Contract not found.');
    if (instance.status !== 'sent') return json({ error: 'This contract can no longer be forwarded.' }, 409);

    const newToken = crypto.randomUUID();
    const { error: updateErr } = await admin
      .from('contract_signing_parties')
      .update({
        name: newName.trim(),
        phone: e164,
        phone_norm: e164 ? e164.replace(/[^0-9]/g, '').slice(-10) : null,
        email: emailNormalized,
        send_sms: sendSms,
        send_email: sendEmailFlag,
        access_token: newToken,
        delegated_from_name: party.name,
        delegated_from_phone: party.phone,
        delegated_from_email: party.email,
        delegated_at: new Date().toISOString(),
      })
      .eq('id', party.id);
    if (updateErr) throw updateErr;

    const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const userAgent = req.headers.get('user-agent');

    await admin.from('contract_audit_events').insert({
      contract_instance_id: party.contract_instance_id,
      party_id: party.id,
      event_type: 'delegated',
      detail: `${party.name} forwarded signing to ${newName.trim()}`,
      ip_address: ipAddress,
      user_agent: userAgent,
    });

    const link = `https://www.bluebirdacquisition.com/crm/sign/${newToken}`;
    const docName = instance.name ?? 'a document';
    const address = instance.property_address ?? '';
    let sentAny = false;

    if (sendSms && e164) {
      try {
        await sendBlueDocsSms(e164, NEXT_SIGNER_MESSAGE(docName, address, link));
        sentAny = true;
      } catch (smsErr) {
        console.error('Blue Docs delegation SMS failed:', smsErr);
      }
    }
    if (sendEmailFlag && emailNormalized) {
      try {
        const html = delegatedToEmailHtml({ recipientName: newName.trim(), docName, address, link, documentId: instance.id });
        await sendEmail(emailNormalized, `${docName} ready for your signature - ${address}`, html);
        sentAny = true;
      } catch (emailErr) {
        console.error('Blue Docs delegation email failed:', emailErr);
      }
    }
    if (sentAny) {
      await admin.from('contract_audit_events').insert({
        contract_instance_id: party.contract_instance_id,
        party_id: party.id,
        event_type: 'sent',
      });
    }

    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unexpected error' }, 500);
  }
});
