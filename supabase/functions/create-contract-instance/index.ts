// Edge Function: create-contract-instance
//
// Blue Docs overhaul, phase 1a — replaces the client-side two-insert flow
// that used to live in useGenerateContract (src/hooks/useContractInstances.ts).
// Moving this server-side makes the whole "create the contract, send the
// first invite" sequence one atomic request: there is no longer a window
// where the DB rows exist but the invite SMS was never attempted because the
// admin's tab closed between two separate client-driven steps.
//
// Admin-only, real logged-in session — same posture and auth pattern as
// send-sms (caller-scoped client for auth.getUser(), then the service-role
// client for everything else).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

// Second delivery channel alongside Zoom SMS, added because 10DLC carrier
// filtering blocks SMS containing a link — which is every message this
// function sends. Supabase Edge Functions block outbound ports 25 and 587
// but not 465 (confirmed against the platform's own docs), which is what
// Hostinger's SMTP wants anyway.
const SMTP_HOST = Deno.env.get('SMTP_HOST')!;
const SMTP_PORT = Number(Deno.env.get('SMTP_PORT') ?? '465');
const SMTP_USER = Deno.env.get('SMTP_USER')!;
const SMTP_PASS = Deno.env.get('SMTP_PASS')!;
const SMTP_FROM_EMAIL = Deno.env.get('SMTP_FROM_EMAIL')!;
const SMTP_FROM_NAME = Deno.env.get('SMTP_FROM_NAME') ?? 'Bluebird Acquisition';

const ZOOM_ACCOUNT_ID = Deno.env.get('ZOOM_ACCOUNT_ID')!;
const ZOOM_CLIENT_ID = Deno.env.get('ZOOM_CLIENT_ID')!;
const ZOOM_CLIENT_SECRET = Deno.env.get('ZOOM_CLIENT_SECRET')!;

// Blue Docs always sends from exactly one number — never round-robins
// across the outreach pool the way send-sms/bulk-sms-dispatcher do — but
// that one number is 217-408-2781, which is also already in that pool
// (NUMBERS['2'] there), not a separate dedicated line. Reuses the exact
// same secrets rather than duplicating the phone/email into a new pair, so
// there's one source of truth if that number ever changes. sms-webhook's
// guard against createLeadFromUnmatched accounts for the sharing — see
// that function's own comment — a reply from someone already recognized
// as a lead still flows through the normal AI-reply path untouched.
const BLUEDOCS_NUMBER = {
  phone: Deno.env.get('ZOOM_FROM_NUMBER_2') ?? '',
  email: Deno.env.get('ZOOM_USER_EMAIL_2') ?? '',
  label: Deno.env.get('ZOOM_LABEL_2') ?? 'Blue Docs',
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

// ── Zoom sending (duplicated from send-sms, not shared — this codebase's
// own established convention, see sms-backfill/bulk-sms-dispatcher). ───────
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

function toE164(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

const INVITE_MESSAGE = (docName: string, address: string, link: string) =>
  `Hey, here's the link to the ${docName} contract for your property\n${address}\n${link}\nSign it and let's start moving with it\nThanks,\nDayyan`;

// ── Email (duplicated into submit-signature too, not shared — matches this
// codebase's own established convention for the Zoom SMS helpers above). ───
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

/** Shared header/footer chrome — table-based, every style inlined, since
 * email clients (Gmail especially) strip <style> blocks and don't support
 * flexbox/grid. The same shell wraps every Blue Docs email. */
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

/** Used for both the initial invite and (from submit-signature) the
 * next-signer nudge — same shape, only the opening line differs. */
function signRequestEmailHtml(opts: { opener: string; docName: string; address: string; link: string }): string {
  const { opener, docName, address, link } = opts;
  const body = `
<p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#C9A24B;">Signature Requested</p>
<h1 style="margin:6px 0 0;font-size:20px;font-weight:700;color:#0B1E33;">${opener}</h1>
<p style="margin:14px 0 0;font-size:14px;line-height:1.6;color:#45566B;">${docName} is ready for your signature. Review it and sign electronically — it only takes a couple of minutes.</p>
${addressCallout(address)}
${ctaButton(link, 'Review &amp; Sign Document', '#C9A24B', '#0B1E33')}
<p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#45566B;">Sign it and let's start moving with it.<br>Thanks,<br>Dayyan</p>
${fallbackLink(link)}`;
  return emailShell(`${docName} is ready for your signature`, body);
}

interface ContractField {
  id: string;
  role: string;
  type: string;
}
interface PartyRoleDef {
  id: string;
  label: string;
}
interface PartyInput {
  role: string;
  name: string;
  phone: string;
  email?: string;
  sendSms: boolean;
  sendEmail: boolean;
  signOrder: number;
}

function isValidEmail(raw: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw.trim());
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });

    const { data: userData } = await withTimeout(callerClient.auth.getUser(), 'auth.getUser()');
    const userId = userData?.user?.id;
    if (!userId) return json({ error: 'Not signed in.' }, 401);

    const { data: profile } = await withTimeout(
      admin.from('profiles').select('role').eq('id', userId).single(),
      'profile lookup',
    );
    if (profile?.role !== 'admin') return json({ error: 'Admins only.' }, 403);

    const body = await req.json();
    const { templateId, leadId, name, propertyAddress, fieldValues, parties } = body as {
      templateId: string;
      leadId?: string;
      name: string;
      propertyAddress?: string;
      fieldValues: Record<string, string>;
      parties: PartyInput[];
    };

    if (!templateId || !name || !propertyAddress?.trim() || !parties?.length) {
      return json({ error: 'Missing required fields.' }, 400);
    }
    // Only actually required when at least one party is being texted — an
    // all-email send has no reason to depend on the Zoom number being set up.
    if (parties.some((p) => p.sendSms) && (!BLUEDOCS_NUMBER.phone || !BLUEDOCS_NUMBER.email)) {
      return json({ error: 'Blue Docs sending number is not configured yet.' }, 500);
    }

    // Phone is only required if this party is actually being texted, same
    // for email — a party going out email-only never had a real phone
    // number to validate, and requiring one just to satisfy this check
    // would defeat the entire reason email delivery exists.
    const normalizedParties: (PartyInput & { e164: string | null; emailNormalized: string | null })[] = [];
    for (const p of parties) {
      if (!p.sendSms && !p.sendEmail) return json({ error: `"${p.name}" needs at least one delivery method selected.` }, 400);
      let e164: string | null = null;
      if (p.sendSms) {
        e164 = toE164(p.phone ?? '');
        if (!e164) return json({ error: `"${p.name}" needs a valid phone number to send by SMS.` }, 400);
      }
      let emailNormalized: string | null = null;
      if (p.sendEmail) {
        const trimmed = (p.email ?? '').trim();
        if (!isValidEmail(trimmed)) return json({ error: `"${p.name}" needs a valid email address to send by email.` }, 400);
        emailNormalized = trimmed;
      }
      normalizedParties.push({ ...p, e164, emailNormalized });
    }

    const { data: template, error: templateErr } = await withTimeout(
      admin.from('doc_templates').select('type, fields, party_roles, storage_path, docx_storage_path').eq('id', templateId).single(),
      'template lookup',
    );
    if (templateErr) throw templateErr;

    // A template can define fields for an optional role nobody actually
    // filled in this send (e.g. a co-seller/co-buyer section only some
    // deals need) — those fields still exist on the template row for the
    // NEXT contract that does need them, but stamping them into THIS
    // instance's own snapshot would leave a permanently-unsigned "not yet
    // signed" placeholder on a document where that role was never sent to
    // anyone and never will sign. Excluded unless either (a) a live party
    // actually has that role, or (b) it already got a pre-filled value —
    // some roles (Novation/Cash Deal's built-in "buyer") are pre-fill-only
    // and never get a live signing party at all, so role-presence alone
    // would wrongly strip every one of their fields (name, price, address,
    // ...) off of every single contract.
    const sentRoles = new Set(normalizedParties.map((p) => p.role));
    const prefilledIds = new Set(Object.keys(fieldValues ?? {}));
    const templateFields = Array.isArray(template.fields) ? (template.fields as ContractField[]) : [];
    const relevantFields = templateFields.filter((f) => sentRoles.has(f.role) || prefilledIds.has(f.id));

    // Hashed at send time so the certificate can later show whether the
    // blank template itself changed between being sent and being signed —
    // tamper-evidence for the starting document, not just the finished one.
    const { data: pdfBlob, error: dlErr } = await withTimeout(
      admin.storage.from('blue-docs').download(template.storage_path),
      'template download',
    );
    if (dlErr) throw dlErr;
    const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());
    const hashBuffer = await crypto.subtle.digest('SHA-256', pdfBytes);
    const templateSha256 = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');

    const { data: instance, error: instErr } = await admin
      .from('contract_instances')
      .insert({
        template_id: templateId,
        lead_id: leadId ?? null,
        name,
        property_address: propertyAddress.trim(),
        field_values: fieldValues ?? {},
        created_by: userId,
        status: 'sent',
        template_fields_snapshot: relevantFields,
        template_party_roles_snapshot: template.party_roles,
        template_storage_path_snapshot: template.storage_path,
        template_docx_storage_path_snapshot: template.docx_storage_path,
        template_pdf_sha256: templateSha256,
      })
      .select('id')
      .single();
    if (instErr) throw instErr;

    const { data: insertedParties, error: partiesErr } = await admin
      .from('contract_signing_parties')
      .insert(
        normalizedParties.map((p) => ({
          contract_instance_id: instance.id,
          role: p.role,
          name: p.name,
          phone: p.e164,
          email: p.emailNormalized,
          send_sms: p.sendSms,
          send_email: p.sendEmail,
          sign_order: p.signOrder,
        })),
      )
      .select('id, role, name, access_token, sign_order, phone, email, send_sms, send_email');
    if (partiesErr) throw partiesErr;

    const firstParty = [...insertedParties].sort((a, b) => a.sign_order - b.sign_order)[0];
    const docKind = template.type === 'loi' ? 'your Letter of Intent' : name;
    const link = `https://www.bluebirdacquisition.com/crm/sign/${firstParty.access_token}`;
    let sentAny = false;

    if (firstParty.send_sms && firstParty.phone) {
      try {
        const token = await withTimeout(zoomToken(), 'Zoom auth');
        await withTimeout(zoomUserId(BLUEDOCS_NUMBER.email, token), 'Zoom user lookup');
        await withTimeout(
          sendZoomSms(BLUEDOCS_NUMBER.phone, firstParty.phone, INVITE_MESSAGE(docKind, propertyAddress.trim(), link), token),
          'Zoom send',
        );
        sentAny = true;
      } catch (smsErr) {
        // The contract instance and parties are already created — a send
        // failure shouldn't lose that. The admin can still copy the link
        // manually from the Envelopes dashboard; this just logs the miss.
        console.error('Blue Docs invite SMS failed:', smsErr);
      }
    }

    if (firstParty.send_email && firstParty.email) {
      try {
        const html = signRequestEmailHtml({
          opener: `Hi ${firstParty.name.split(' ')[0]}, you have a document to sign`,
          docName: docKind,
          address: propertyAddress.trim(),
          link,
        });
        await sendEmail(firstParty.email, `${docKind} ready for your signature — ${propertyAddress.trim()}`, html);
        sentAny = true;
      } catch (emailErr) {
        console.error('Blue Docs invite email failed:', emailErr);
      }
    }

    if (sentAny) {
      await admin.from('contract_audit_events').insert({
        contract_instance_id: instance.id,
        party_id: firstParty.id,
        event_type: 'sent',
      });
    }

    return json({
      instanceId: instance.id as string,
      parties: insertedParties.map((p) => ({ role: p.role, name: p.name, access_token: p.access_token, sign_order: p.sign_order })),
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unexpected error' }, 500);
  }
});
