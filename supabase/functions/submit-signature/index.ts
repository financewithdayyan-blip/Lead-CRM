// Edge Function: submit-signature
//
// Public/unauthenticated, same posture as sms-webhook — the access_token
// embedded in the signer's own URL is the credential, not a login. Records
// one party's completion (a drawn/typed signature if their role actually has
// a signature field mapped, or just a plain confirmation if not — a party
// with nothing assigned to sign still has to formally complete their turn so
// the next party unlocks and the contract can finish). Once every party is
// done, stamps every mapped field onto the template PDF with pdf-lib,
// appends a signing-certificate page (who signed what, when, from where),
// and stores the flattened result as the contract's final executed document.
// Pinned rather than the floating @2 tag — esm.sh's "latest" resolution
// briefly served a 2.112.1 build with a broken denonext auth-js subpath,
// which failed every fresh bundle regardless of this function's own code.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { PDFDocument, StandardFonts, rgb, LineCapStyle, type PDFFont, type PDFPage } from 'https://esm.sh/pdf-lib@1.17.1';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';
import { encode as base64Encode } from 'https://deno.land/std@0.173.0/encoding/base64.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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
// Blue Docs always sends from 217-408-2781, which is also NUMBERS['2'] in
// the outreach pool (send-sms/bulk-sms-dispatcher), not a separate
// dedicated line — reuses those same secrets rather than duplicating them.
// See create-contract-instance's own comment on this and sms-webhook's
// updated guard, which accounts for the number being shared.
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

// ── Zoom sending (duplicated from send-sms/create-contract-instance, not
// shared — this codebase's own established convention). A failure anywhere
// in here must never fail the signer's own successful signature — every
// call site below wraps this in try/catch and only logs. ──────────────────
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
  return res.json().catch(() => ({}));
}

/** Fetches a fresh token + resolves the Blue Docs sender's Zoom user id, then
 * sends. One helper since every call site here needs the same two steps
 * first — a signature submission only ever sends at most one SMS itself. */
async function sendBlueDocsSms(toPhone: string, message: string) {
  const token = await withTimeout(zoomToken(), 'Zoom auth');
  await withTimeout(zoomUserId(BLUEDOCS_NUMBER.email, token), 'Zoom user lookup');
  await withTimeout(sendZoomSms(BLUEDOCS_NUMBER.phone, toPhone, message, token), 'Zoom send');
}

const NEXT_SIGNER_MESSAGE = (docName: string, address: string, link: string) =>
  `Hey, it's your turn to sign the ${docName} contract for your property\n${address}\n${link}\nSign it and let's start moving with it\nThanks,\nDayyan`;
const COMPLETED_MESSAGE = (link: string) =>
  `Hey Congrats🎉🎉!\n\nOn signing the contract on your property\nyou can download the signed contract.\nJust click the link below\n\n${link}\n\nThanks for signing,\nDayyan`;

// denomailer's content:'auto' path quoted-printable-encodes the html body
// and soft-wraps it every 74 characters with no regard for what it splits —
// confirmed by direct reproduction that this lands mid-URL inside a real
// <a href> (e.g. the "." right after "www" in a signing link). Base64 is
// immune: a decoder concatenates every line before decoding fixed 4-char
// blocks, so a line wrap can never land inside a token.
function toMimeHtml(html: string) {
  const b64 = base64Encode(html).match(/.{1,76}/g)?.join('\r\n') ?? base64Encode(html);
  return [{ mimeType: 'text/html; charset="utf-8"', content: b64, transferEncoding: 'base64' }];
}

// ── Email (duplicated from create-contract-instance, not shared — matches
// this codebase's own established convention for the Zoom SMS helpers
// above). Every call site wraps this in try/catch, same as sendBlueDocsSms —
// a failed email must never fail the signer's own already-recorded
// signature or cost another party their own notification. ──────────────────
async function sendEmail(
  to: string,
  subject: string,
  html: string,
  attachments?: { filename: string; contentType: string; encoding: 'binary'; content: Uint8Array }[],
) {
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
      client.send({ from: `${SMTP_FROM_NAME} <${SMTP_FROM_EMAIL}>`, to, subject, mimeContent: toMimeHtml(html), attachments }),
      'SMTP send',
    );
  } finally {
    await client.close();
  }
}

// Known field ids for the Cash Deal PSA template only (see
// FillCashDealContractModal's own FIELD_MAP, which this mirrors) — used
// solely to surface human Purchase price / EMD / Title company / Closing
// date values in these emails. No other template currently has an
// equivalent concept, so every other contract type's email simply omits
// whichever of these rows it can't resolve. If this template is ever
// re-mapped in the field editor, these ids need updating to match.
const CASH_DEAL_TEMPLATE_ID = 'b7b8fc5c-dfc1-466d-b12f-ada853c9180c';
const CASH_DEAL_FIELD_IDS = {
  purchasePrice: 'b95b1ea0-a8f0-4fda-a0db-91b232299515',
  emdAmount: 'c1654e71-3c41-4216-8c91-8130873deec7',
  titleCompany: 'e9566337-b341-4d88-a02c-e4bcd0ea16c0',
  closingDate: 'ebfb718b-a8d6-4017-b426-732dac8fec12',
} as const;

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

/** Friendly, signer-facing timestamp (vs. formatWhen's fixed-UTC audit-trail
 * version above) — Eastern time, since that's where this business operates. */
function formatFriendlyWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' });
}

/** closingDate's raw stored value is whatever a plain <input type="date">
 * produced (an unformatted "YYYY-MM-DD") — this is just for display. Falls
 * back to the raw string for anything that doesn't parse as a plain date. */
function formatDateOnly(raw: string): string {
  const d = new Date(`${raw}T00:00:00`);
  return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString('en-US', { dateStyle: 'medium' });
}

/** Shared header/footer chrome — table-based, every style inlined, since
 * email clients (Gmail especially) strip <style> blocks and don't support
 * flexbox/grid. The same shell wraps every Blue Docs email. A plain white
 * header (document "Ref" top-right) and a two-line footer note, matching the
 * product's own branded letter/receipt look rather than a generic email. */
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

/** A receipt-style key/value list — a thin top border per row, label left,
 * value right. Used for the Property/Purchase price rows in the
 * signature-request email and the Signed-by rows in the completion email. */
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

function ctaButton(link: string, label: string, bg: string, color: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${bg};border-radius:10px;">
<a href="${link}" style="display:inline-block;padding:14px 28px;font-size:14px;font-weight:700;color:${color};text-decoration:none;">${label}</a>
</td></tr></table>`;
}

function fallbackLink(link: string): string {
  return `<p style="margin:20px 0 0;font-size:11.5px;color:#8693A1;word-break:break-all;">Button not working? Copy this link into your browser:<br><a href="${link}" style="color:#1568A8;">${link}</a></p>`;
}

/** The full-width pale banner at the top of the completion email ("Fully
 * signed by all parties"). */
function statusBanner(text: string): string {
  return `<div style="margin:0 0 20px;padding:10px 16px;background:#EAF2FA;border-radius:8px;font-size:12.5px;font-weight:600;color:#1568A8;">&#10003; ${text}</div>`;
}

function numberedStep(n: number, title: string, body: string): string {
  return `
<tr>
<td style="padding:0 14px 20px 0;vertical-align:top;width:28px;font-size:12px;font-weight:700;color:#8693A1;">${String(n).padStart(2, '0')}</td>
<td style="padding:0 0 20px;vertical-align:top;">
<div style="font-size:13.5px;font-weight:700;color:#0B1E33;">${title}</div>
<div style="margin-top:2px;font-size:13px;line-height:1.5;color:#45566B;">${body}</div>
</td>
</tr>`;
}

function stepsTable(stepsHtml: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;">${stepsHtml}</table>`;
}

/** Same shell create-contract-instance uses for the initial invite — this is
 * the next-signer nudge, identical shape, just a different intro paragraph. */
function signRequestEmailHtml(opts: {
  recipientName: string;
  docName: string;
  address: string;
  link: string;
  documentId: string;
  intro: string;
  purchasePrice?: string;
}): string {
  const { recipientName, docName, address, link, documentId, intro, purchasePrice } = opts;
  const firstName = recipientName.split(' ')[0];
  const docNameForHeading = docName.replace(/^your\s+/i, '');
  const rows: Array<{ label: string; value: string }> = [{ label: 'Property', value: address }];
  if (purchasePrice) rows.push({ label: 'Purchase price', value: purchasePrice });
  const body = `
<p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#1568A8;">Ready for your signature</p>
<h1 style="margin:0;font-size:21px;line-height:1.35;font-weight:700;color:#0B1E33;">Your ${docNameForHeading} for ${address}</h1>
<p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:#45566B;">Hi ${firstName},</p>
<p style="margin:10px 0 0;font-size:14px;line-height:1.6;color:#45566B;">${intro}</p>
${detailTable(rows)}
${ctaButton(link, 'Review and sign', '#0B1E33', '#ffffff')}
<p style="margin:14px 0 0;font-size:12.5px;line-height:1.6;color:#8693A1;">Takes about five minutes and works on your phone.</p>
<p style="margin:24px 0 0;font-size:13.5px;line-height:1.6;color:#45566B;">Questions before you sign? Call me directly at ${AGENT_PHONE_DISPLAY} or just reply to this email.</p>
<p style="margin:18px 0 0;font-size:13.5px;line-height:1.6;color:#0B1E33;font-weight:600;">${AGENT_NAME}<br><span style="font-weight:400;color:#8693A1;">Acquisitions, Bluebird Acquisition</span></p>
${fallbackLink(link)}`;
  return emailShell(`${docName} is ready for your signature`, body, {
    documentId,
    footerNote: `We will never ask for bank details or payment by email. If something looks off, call ${AGENT_PHONE_DISPLAY} before signing.`,
  });
}

/** Builds the "Signed by ..." rows for the completion email, from the
 * recipient's own perspective — "Signed by you" for their own signature,
 * one row per other seller-side signer (co-seller, if any), and a single
 * collapsed "Signed by Bluebird Acquisition" row for whichever non-seller
 * party (buyer/extra role) signed, using the latest timestamp if more than
 * one exists. Skips a row entirely if its timestamp is somehow missing
 * rather than printing a blank value. */
function buildSignedRows(
  recipient: { id: string; signed_at: string | null },
  allParties: Array<{ id: string; role: string; name: string; signed_at: string | null }>,
): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  if (recipient.signed_at) rows.push({ label: 'Signed by you', value: formatFriendlyWhen(recipient.signed_at) });

  const others = allParties.filter((p) => p.id !== recipient.id);
  const isSellerSide = (role: string) => role === 'seller' || role.startsWith('seller_');
  for (const p of others.filter((p) => isSellerSide(p.role))) {
    if (p.signed_at) rows.push({ label: `Signed by ${p.name.split(' ')[0]}`, value: formatFriendlyWhen(p.signed_at) });
  }
  const businessSide = others.filter((p) => !isSellerSide(p.role) && p.signed_at);
  const latestBusiness = businessSide.sort((a, b) => new Date(b.signed_at!).getTime() - new Date(a.signed_at!).getTime())[0];
  if (latestBusiness) rows.push({ label: 'Signed by Bluebird Acquisition', value: formatFriendlyWhen(latestBusiness.signed_at!) });

  return rows;
}

/** The fully-executed completion email — sent alongside a PDF attachment
 * of the actual signed copy (finalBytes, already on hand from the
 * certificate-of-completion build below), not just a link. The download
 * link stays too as a fallback for whichever mail client/filter strips or
 * blocks the attachment. "What happens next" walks the deal's remaining
 * steps in order: walkthrough/inspection, EMD deposit, opening title, then
 * closing — title company and closing date are only named when the Cash
 * Deal template actually captured them; every other case stays generic. */
function signedCompleteEmailHtml(opts: {
  recipientName: string;
  address: string;
  link: string;
  documentId: string;
  signedRows: Array<{ label: string; value: string }>;
  titleCompany?: string;
  closingDate?: string;
  emdAmount?: string;
}): string {
  const { recipientName, address, link, documentId, signedRows, titleCompany, closingDate, emdAmount } = opts;
  const firstName = recipientName.split(' ')[0];
  const steps = [
    {
      title: 'Walkthrough and inspection',
      body: "I'll reach out to schedule a time that works for you to walk the property together.",
    },
    {
      title: 'EMD deposit',
      body: emdAmount
        ? `Your earnest money deposit of ${emdAmount} goes to the title company to formally open escrow.`
        : 'Your earnest money deposit goes to the title company to formally open escrow.',
    },
    {
      title: 'Opening title',
      body: titleCompany
        ? `${titleCompany} will contact you within two business days to start the title search.`
        : 'The title company will contact you within two business days to start the title search.',
    },
    {
      title: 'Closing',
      body: closingDate
        ? `Currently set for ${closingDate}. You'll get the details a few days before.`
        : "We'll confirm your closing date and send the details a few days before.",
    },
  ];
  const stepsHtml = steps.map((s, i) => numberedStep(i + 1, s.title, s.body)).join('');
  const body = `
${statusBanner('Fully signed by all parties')}
<h1 style="margin:0;font-size:21px;line-height:1.35;font-weight:700;color:#0B1E33;">&#127881; Congratulations, ${firstName}. It's official.</h1>
<p style="margin:14px 0 0;font-size:14px;line-height:1.6;color:#45566B;">The agreement for ${address} has been signed by everyone. You're under contract. Thank you for working with us. We'll take it from here and keep you posted at each step.</p>
${detailTable(signedRows)}
${ctaButton(link, 'Download signed copy', '#0B1E33', '#ffffff')}
<p style="margin:32px 0 10px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#0B1E33;">What happens next</p>
${stepsTable(stepsHtml)}
<p style="margin:10px 0 0;font-size:13.5px;line-height:1.6;color:#45566B;">If anything comes up before closing, call me at ${AGENT_PHONE_DISPLAY} or reply here.</p>
<p style="margin:18px 0 0;font-size:13.5px;line-height:1.6;color:#0B1E33;font-weight:600;">${AGENT_NAME}<br><span style="font-weight:400;color:#8693A1;">Acquisitions, Bluebird Acquisition</span></p>`;
  return emailShell(`Your agreement for ${address} has been signed by everyone`, body, {
    documentId,
    footerNote: `Keep this email for your records. The signed agreement and its audit trail are stored under Ref: ${shortRef(documentId)}.`,
  });
}

interface ContractField {
  id: string;
  page: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  type: 'text' | 'signature' | 'date' | 'full_name' | 'currency' | 'paragraph' | 'tickmark';
  // 'buyer' | 'seller', or a template-defined extra role id (e.g. "extra_1").
  role: string;
  label: string;
}

interface PartyRoleDef {
  id: string;
  label: string;
}

function roleWordFor(role: string, docType: string, partyRoles: PartyRoleDef[]): string {
  if (role === 'other') return 'Additional Signer';
  if (role === 'buyer') return docType === 'loi' ? 'Us' : 'Buyer';
  if (role === 'seller') return 'Seller';
  return partyRoles.find((r) => r.id === role)?.label ?? 'Additional Signer';
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Greedy word-wrap against the font's actual measured width — a clause is
 * whatever length the seller/buyer typed, so this is what turns that into
 * lines that actually fit inside the mapped box on the real PDF page. */
function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

// Brand palette (normalized from the same hex values used on the marketing
// site/CRM — see scripts/blog-template.mjs's :root tokens) so the appended
// certificate reads as part of the same product, not a generic pdf-lib dump.
const BRAND: [number, number, number] = [0.1176, 0.5608, 0.8353]; // #1E8FD5
const INK: [number, number, number] = [0.0431, 0.1176, 0.2]; // #0B1E33
const SLATE: [number, number, number] = [0.3412, 0.4, 0.4784]; // #57667A
const SLATE_DIM: [number, number, number] = [0.5255, 0.5765, 0.6314]; // #8693A1
const SUCCESS: [number, number, number] = [0.0627, 0.5255, 0.4157]; // #10866A
const RULE: [number, number, number] = [0.87, 0.87, 0.87];

function formatWhen(iso: string): string {
  // Fixed to UTC regardless of the edge runtime's own locale/timezone, so a
  // legal audit trail never has an ambiguous "whose clock is this" question.
  return `${new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC' })} UTC`;
}

/** Stateful cursor for the appended certificate page(s) — starts a new page
 * automatically once the current one runs out of room, stamps a brand bar
 * on every page as it's created, and stamps page-number footers on every
 * page in one final pass once the total page count is actually known. */
class CertWriter {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  width: number;
  height: number;
  margin = 54;
  page: PDFPage;
  y: number;
  pages: PDFPage[] = [];

  constructor(doc: PDFDocument, font: PDFFont, bold: PDFFont, width: number, height: number) {
    this.doc = doc;
    this.font = font;
    this.bold = bold;
    this.width = width;
    this.height = height;
    this.page = this.newPage();
  }

  private newPage(): PDFPage {
    const page = this.doc.addPage([this.width, this.height]);
    page.drawRectangle({ x: 0, y: this.height - 5, width: this.width, height: 5, color: rgb(...BRAND) });
    this.pages.push(page);
    this.y = this.height - this.margin - 12;
    return page;
  }

  private ensureRoom(lineHeight: number) {
    // Reserves a footer zone below `margin` so page-number/title stamps
    // (drawn in the finalize() pass, after content is already placed) never
    // collide with real content.
    if (this.y - lineHeight < this.margin) {
      this.page = this.newPage();
    }
  }

  heading(text: string) {
    this.ensureRoom(26);
    this.page.drawText(text, { x: this.margin, y: this.y, size: 18, font: this.bold, color: rgb(...INK) });
    this.y -= 28;
  }

  /** Small uppercase-ish section label, e.g. "DOCUMENT OVERVIEW". */
  eyebrow(text: string) {
    this.ensureRoom(20);
    this.page.drawText(text.toUpperCase(), { x: this.margin, y: this.y, size: 9, font: this.bold, color: rgb(...BRAND) });
    this.y -= 16;
  }

  divider() {
    this.ensureRoom(10);
    this.page.drawLine({
      start: { x: this.margin, y: this.y },
      end: { x: this.width - this.margin, y: this.y },
      thickness: 0.75,
      color: rgb(...RULE),
    });
    this.y -= 14;
  }

  line(text: string, opts: { size?: number; color?: [number, number, number]; bold?: boolean } = {}) {
    const size = opts.size ?? 10;
    const [r, g, b] = opts.color ?? SLATE;
    const font = opts.bold ? this.bold : this.font;
    const maxWidth = this.width - this.margin * 2;
    for (const wrapped of wrapText(text, font, size, maxWidth)) {
      this.ensureRoom(size * 1.4);
      this.page.drawText(wrapped, { x: this.margin, y: this.y, size, font, color: rgb(r, g, b) });
      this.y -= size * 1.4;
    }
  }

  /** A bold label immediately followed by its value on the same baseline —
   * the closest a single-column writer gets to a real table row without
   * building full grid/border layout logic. Falls back to wrapping the
   * value on its own indented line(s) if it won't fit next to the label. */
  keyValue(label: string, value: string, opts: { size?: number } = {}) {
    const size = opts.size ?? 9.5;
    const labelText = `${label}:`;
    const labelWidth = this.bold.widthOfTextAtSize(labelText, size);
    const valueMaxWidth = this.width - this.margin * 2 - labelWidth - 6;
    const wrapped = wrapText(value || '—', this.font, size, valueMaxWidth);

    this.ensureRoom(size * 1.5);
    this.page.drawText(labelText, { x: this.margin, y: this.y, size, font: this.bold, color: rgb(...SLATE) });
    this.page.drawText(wrapped[0] ?? '', { x: this.margin + labelWidth + 6, y: this.y, size, font: this.font, color: rgb(...INK) });
    this.y -= size * 1.5;
    for (const extra of wrapped.slice(1)) {
      this.ensureRoom(size * 1.5);
      this.page.drawText(extra, { x: this.margin + labelWidth + 6, y: this.y, size, font: this.font, color: rgb(...INK) });
      this.y -= size * 1.5;
    }
  }

  gap(px = 10) {
    this.y -= px;
  }

  /** Stamps "Page N of TOTAL" + a title footer on every page written so
   * far — only callable once, after all real content is placed, since the
   * total page count isn't known until then. */
  finalize(footerTitle: string) {
    const total = this.pages.length;
    this.pages.forEach((page, i) => {
      const footerY = this.margin - 20;
      page.drawLine({ start: { x: this.margin, y: footerY + 12 }, end: { x: this.width - this.margin, y: footerY + 12 }, thickness: 0.5, color: rgb(...RULE) });
      page.drawText(footerTitle, { x: this.margin, y: footerY, size: 7.5, font: this.font, color: rgb(...SLATE_DIM) });
      const pageLabel = `Page ${i + 1} of ${total}`;
      const w = this.font.widthOfTextAtSize(pageLabel, 7.5);
      page.drawText(pageLabel, { x: this.width - this.margin - w, y: footerY, size: 7.5, font: this.font, color: rgb(...SLATE_DIM) });
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const {
      token,
      signatureDataUrl,
      signatureName,
      fieldValues: submittedFieldValues,
      signatureFieldValues,
      signatureRememberedConsent,
    }: {
      token: string;
      signatureDataUrl?: string;
      signatureName?: string;
      fieldValues?: Record<string, string>;
      // One rendered image per signature box this party individually
      // signed — see SignContractPage's handleSignField. Merged into the
      // same field_values column as every other field type below, and each
      // key here also gets its own 'field_signed' audit event, which is what
      // actually fixes "signing once fills every signature field for this
      // role": each field now has its own value and its own audit record.
      signatureFieldValues?: Record<string, string>;
      // True only when the signer explicitly checked "Remember my
      // signature" in the per-field popup, opting out of confirming each
      // remaining signature box individually — see the migration note on
      // why this gets its own audit event instead of being implicit.
      signatureRememberedConsent?: boolean;
    } = await req.json();
    if (!token) return json({ error: 'Missing token' }, 400);
    // A rendered signature image with no typed name behind it isn't a real
    // signature — the client only ever sends signatureDataUrl once it has
    // rendered actual typed text (see SignContractPage), so a request
    // carrying one without the other means the UI's own gating was bypassed.
    if (signatureDataUrl && !signatureName?.trim()) {
      return json({ error: 'A typed name is required to sign.' }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: party, error: partyErr } = await admin
      .from('contract_signing_parties')
      .select('*')
      .eq('access_token', token)
      .maybeSingle();
    if (partyErr) throw partyErr;
    if (!party) return json({ error: 'Signing link not found' }, 404);
    if (party.status === 'signed') return json({ error: 'This has already been signed' }, 409);

    const { data: instanceStatus, error: instanceStatusErr } = await admin
      .from('contract_instances')
      .select('status')
      .eq('id', party.contract_instance_id)
      .single();
    if (instanceStatusErr) throw instanceStatusErr;
    if (['voided', 'declined'].includes(instanceStatus.status)) {
      return json({ error: 'This document is no longer available for signing' }, 409);
    }

    const { data: allParties, error: partiesErr } = await admin
      .from('contract_signing_parties')
      .select('*')
      .eq('contract_instance_id', party.contract_instance_id)
      .order('sign_order', { ascending: true });
    if (partiesErr) throw partiesErr;

    const blockedBy = (allParties ?? []).find((p) => p.sign_order < party.sign_order && p.status !== 'signed');
    if (blockedBy) return json({ error: `Waiting on ${blockedBy.name} to sign first` }, 409);

    // The consent screen in SignContractPage already gates this client-side,
    // but the server shouldn't trust that it was actually shown — same
    // reasoning this table's own RLS comment gives for never taking a
    // client-reported audit event at face value.
    const { count: consentCount } = await admin
      .from('contract_audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('party_id', party.id)
      .eq('event_type', 'consented');
    if (!consentCount) return json({ error: 'You need to consent to sign electronically first.' }, 409);

    const signedAt = new Date().toISOString();
    const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const userAgent = req.headers.get('user-agent');

    const { error: updateErr } = await admin
      .from('contract_signing_parties')
      .update({
        status: 'signed',
        signature_data_url: signatureDataUrl ?? null,
        typed_signature_name: signatureName?.trim() || null,
        signed_at: signedAt,
      })
      .eq('id', party.id);
    if (updateErr) throw updateErr;

    await admin.from('contract_audit_events').insert({
      contract_instance_id: party.contract_instance_id,
      party_id: party.id,
      event_type: 'signed',
      ip_address: ipAddress,
      user_agent: userAgent,
    });

    // Whatever this party typed into their own fields (name, amount, etc.)
    // and every signature box they individually signed both merge into the
    // same shared field_values column — a signature field's "value" is just
    // its rendered image data URL, stored and read back exactly like any
    // other field's typed value. The next party (and the final flattened
    // PDF) read this same column, so it has to land before either.
    const allSubmittedFieldValues = { ...(submittedFieldValues ?? {}), ...(signatureFieldValues ?? {}) };
    if (Object.keys(allSubmittedFieldValues).length > 0) {
      const { data: currentInstance } = await admin
        .from('contract_instances')
        .select('field_values')
        .eq('id', party.contract_instance_id)
        .single();
      const merged = { ...(currentInstance?.field_values ?? {}), ...allSubmittedFieldValues };
      await admin.from('contract_instances').update({ field_values: merged }).eq('id', party.contract_instance_id);
    }

    // One audit event per signature box this party actually completed in
    // this submission — the whole point of going box by box. Each row is
    // independently timestamped and IP/user-agent-stamped, tagged with its
    // own field id, so two signature fields for the same party are two
    // distinct, individually attributable records instead of one blanket
    // "signed" event covering however many boxes that role happened to have.
    if (signatureFieldValues && Object.keys(signatureFieldValues).length > 0) {
      await admin.from('contract_audit_events').insert(
        Object.keys(signatureFieldValues).map((fieldId) => ({
          contract_instance_id: party.contract_instance_id,
          party_id: party.id,
          event_type: 'field_signed',
          field_id: fieldId,
          ip_address: ipAddress,
          user_agent: userAgent,
        })),
      );
    }

    // The explicit, logged record of opting out of per-field confirmation —
    // a real step down in deliberateness from confirming every box, so it
    // gets its own distinct audit event rather than disappearing into the
    // field_signed rows above.
    if (signatureRememberedConsent) {
      await admin.from('contract_audit_events').insert({
        contract_instance_id: party.contract_instance_id,
        party_id: party.id,
        event_type: 'signature_remembered',
        ip_address: ipAddress,
        user_agent: userAgent,
      });
    }

    const updatedParties = (allParties ?? []).map((p) =>
      p.id === party.id ? { ...p, status: 'signed', signature_data_url: signatureDataUrl ?? null, signed_at: signedAt } : p,
    );
    const allSigned = updatedParties.every((p) => p.status === 'signed');

    if (!allSigned) {
      // Whoever's now lowest sign_order among the still-pending parties just
      // got unlocked by this signature — notify them. Wrapped so a Zoom
      // hiccup here never fails the signer's own already-recorded signature.
      const nextParty = updatedParties.filter((p) => p.status !== 'signed').sort((a, b) => a.sign_order - b.sign_order)[0];
      if (nextParty?.send_sms || nextParty?.send_email) {
        const { data: nameRow } = await admin
          .from('contract_instances')
          .select('name, property_address, template_id, field_values')
          .eq('id', party.contract_instance_id)
          .single();
        const link = `https://www.bluebirdacquisition.com/crm/sign/${nextParty.access_token}`;
        const docName = nameRow?.name ?? 'a document';
        const address = nameRow?.property_address ?? '';
        let sentAny = false;

        if (nextParty.send_sms && nextParty.phone) {
          try {
            await sendBlueDocsSms(nextParty.phone, NEXT_SIGNER_MESSAGE(docName, address, link));
            sentAny = true;
          } catch (smsErr) {
            console.error('Blue Docs next-signer SMS failed:', smsErr);
          }
        }
        if (nextParty.send_email && nextParty.email) {
          try {
            const nextFieldValues = (nameRow?.field_values ?? {}) as Record<string, string>;
            const purchasePrice =
              nameRow?.template_id === CASH_DEAL_TEMPLATE_ID
                ? nextFieldValues[CASH_DEAL_FIELD_IDS.purchasePrice] || undefined
                : undefined;
            const html = signRequestEmailHtml({
              recipientName: nextParty.name,
              docName,
              address,
              link,
              documentId: party.contract_instance_id,
              intro: "It's your turn to sign. Please read it through and sign online when you're ready — the other party is waiting on you.",
              purchasePrice,
            });
            await sendEmail(nextParty.email, `Your turn to sign - ${docName}`, html);
            sentAny = true;
          } catch (emailErr) {
            console.error('Blue Docs next-signer email failed:', emailErr);
          }
        }
        if (sentAny) {
          await admin.from('contract_audit_events').insert({
            contract_instance_id: party.contract_instance_id,
            party_id: nextParty.id,
            event_type: 'sent',
          });
        }
      }
      return json({ ok: true, allSigned: false });
    }

    // ── Every party has signed — flatten the final PDF. ──────────────────────
    // Reads the field layout/file path off the contract instance's own
    // snapshot columns (taken when it was sent), not a live join to
    // doc_templates — a template edited after this contract was sent must
    // never change what gets stamped onto an already-in-flight document.
    // doc_templates is still joined for type/name, which aren't versioned.
    const { data: instance, error: instErr } = await admin
      .from('contract_instances')
      .select('*, doc_templates(type, name)')
      .eq('id', party.contract_instance_id)
      .single();
    if (instErr) throw instErr;

    const template = {
      storage_path: instance.template_storage_path_snapshot as string,
      fields: (instance.template_fields_snapshot ?? []) as ContractField[],
      type: (instance as any).doc_templates?.type as string,
      name: (instance as any).doc_templates?.name as string,
      party_roles: (instance.template_party_roles_snapshot ?? []) as PartyRoleDef[],
    };
    const partyRoles = template.party_roles ?? [];
    const fieldValues = (instance.field_values ?? {}) as Record<string, string>;

    const { data: pdfBlob, error: dlErr } = await admin.storage.from('blue-docs').download(template.storage_path);
    if (dlErr) throw dlErr;
    const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());

    const pdfDoc = await PDFDocument.load(pdfBytes);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const pages = pdfDoc.getPages();

    const partyByRole = new Map(updatedParties.map((p) => [p.role, p]));

    for (const field of template.fields ?? []) {
      const page = pages[field.page - 1];
      if (!page) continue;
      const { width: pageW, height: pageH } = page.getSize();
      const x = (field.xPct / 100) * pageW;
      const boxW = (field.wPct / 100) * pageW;
      const boxH = (field.hPct / 100) * pageH;
      const y = pageH * (1 - (field.yPct + field.hPct) / 100);

      if (field.type === 'text' || field.type === 'full_name' || field.type === 'currency' || field.type === 'date') {
        // By generation time these are already resolved into plain display
        // strings (a combined name, a formatted "$410,000", or whatever date
        // the signer actually typed) — stamped identically either way.
        const value = fieldValues[field.id] ?? '';
        if (!value) continue;
        const fontSize = Math.max(8, Math.min(14, boxH * 0.6));
        page.drawText(value, { x: x + 2, y: y + boxH * 0.25, size: fontSize, font, color: rgb(0.05, 0.05, 0.05) });
      } else if (field.type === 'paragraph') {
        const value = fieldValues[field.id] ?? '';
        if (!value) continue;
        const fontSize = 9;
        const lineHeight = fontSize * 1.25;
        const maxLines = Math.max(1, Math.floor(boxH / lineHeight));
        const lines = wrapText(value, font, fontSize, boxW - 4).slice(0, maxLines);
        let lineY = y + boxH - fontSize;
        for (const line of lines) {
          page.drawText(line, { x: x + 2, y: lineY, size: fontSize, font, color: rgb(0.05, 0.05, 0.05) });
          lineY -= lineHeight;
        }
      } else if (field.type === 'tickmark') {
        if (fieldValues[field.id] !== 'true') continue;
        // A plain checkmark stroke, not a text glyph — StandardFonts.Helvetica
        // is WinAnsi-encoded and doesn't reliably render U+2713 across every
        // PDF viewer, so this draws the same two-stroke check by hand. The
        // printed checkbox glyph on these templates is small, so this is
        // deliberately drawn bold and slightly past the box's own edges
        // (negative pad) — a faint check confined exactly to a tiny ☐ reads
        // as barely-there next to the surrounding body text; a real pen tick
        // overruns the box, and this is drawn to match that.
        const pad = -Math.min(boxW, boxH) * 0.12;
        const x1 = x + pad;
        const y1 = y + boxH * 0.45;
        const x2 = x + boxW * 0.42;
        const y2 = y + pad;
        const x3 = x + boxW - pad;
        const y3 = y + boxH - pad;
        const thickness = Math.max(2.5, boxH * 0.22);
        page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color: rgb(...INK), lineCap: LineCapStyle.Round });
        page.drawLine({ start: { x: x2, y: y2 }, end: { x: x3, y: y3 }, thickness, color: rgb(...INK), lineCap: LineCapStyle.Round });
      } else if (field.type === 'signature') {
        // This specific box's own value first — the actual fix for "one
        // signature fills every signature field for this role." Falls back
        // to the party's single legacy image only when this field was never
        // individually signed (an envelope completed before per-field
        // signing existed, or a stray pre-existing signature field with no
        // recorded value of its own).
        const p = partyByRole.get(field.role);
        const signatureSource = fieldValues[field.id] || p?.signature_data_url;
        if (!signatureSource) continue;
        try {
          const imgBytes = dataUrlToBytes(signatureSource);
          const img = signatureSource.includes('image/jpeg') ? await pdfDoc.embedJpg(imgBytes) : await pdfDoc.embedPng(imgBytes);
          page.drawImage(img, { x, y, width: boxW, height: boxH });
        } catch {
          // A malformed signature image shouldn't fail the whole document —
          // the field simply stays blank on the final PDF.
        }
      }
    }

    // ── Append the signing certificate / audit trail page(s). ────────────────
    const { data: auditEvents } = await admin
      .from('contract_audit_events')
      .select('party_id, event_type, ip_address, user_agent, created_at, field_id, detail')
      .eq('contract_instance_id', instance.id)
      .order('created_at', { ascending: true });

    const fieldLabelById = new Map((template.fields ?? []).map((f) => [f.id, f.label]));

    const EVENT_LABELS: Record<string, string> = {
      sent: 'Invitation Sent',
      viewed: 'Document Viewed',
      consented: 'Consented to Electronic Signature',
      signed: 'Signature Completed',
      declined: 'Declined to Sign',
      reminder_sent: 'Reminder Sent',
      voided: 'Envelope Voided',
      expired: 'Signing Link Expired',
      edited: 'Contract Terms Edited',
      field_signed: 'Signature Field Signed',
      signature_remembered: 'Chose to Reuse Signature for Remaining Fields',
      delegated: 'Signing Forwarded to Another Signer',
    };

    const partyLabelById = new Map(
      updatedParties.map((p) => [p.id, `${roleWordFor(p.role, template.type, partyRoles)} — ${p.name}`]),
    );
    // The signed event remains the best available timestamp/IP for the
    // non-signature fields a party filled — there's still no finer-grained
    // "this exact text field was typed at this exact second" capture, so
    // those stay honestly attributed to the moment they pressed Sign.
    // Signature fields now have the real thing: a field_signed event per
    // box, so each one gets its own timestamp instead of borrowing the
    // party's single signing moment.
    const signedEventByParty = new Map<string, { ip: string | null; ua: string | null; at: string }>();
    const fieldSignedEventByFieldId = new Map<string, { ip: string | null; ua: string | null; at: string }>();
    for (const e of auditEvents ?? []) {
      if (e.event_type === 'signed' && e.party_id) {
        signedEventByParty.set(e.party_id, { ip: e.ip_address, ua: e.user_agent, at: e.created_at });
      }
      if (e.event_type === 'field_signed' && e.field_id) {
        fieldSignedEventByFieldId.set(e.field_id, { ip: e.ip_address, ua: e.user_agent, at: e.created_at });
      }
    }

    const [firstPage] = pages;
    const { width: certW, height: certH } = firstPage ? firstPage.getSize() : { width: 612, height: 792 };
    const cert = new CertWriter(pdfDoc, font, boldFont, certW, certH);

    const docKind = template.type === 'loi' ? 'Letter of Intent' : 'Contract';

    cert.heading('Certificate of Completion');
    cert.line('Bluebird Acquisition — Electronic Signature Audit Trail', { size: 9.5 });
    cert.gap(14);
    cert.divider();

    cert.eyebrow('Document Overview');
    cert.keyValue('Document', `${instance.name} (${docKind})`);
    cert.keyValue('Certificate ID', instance.id);
    cert.keyValue('Status', 'Completed — all required parties have signed');
    cert.keyValue('Completed', formatWhen(new Date().toISOString()));
    if (instance.property_address) cert.keyValue('Property', instance.property_address);
    // Only the starting template's hash can be printed here without being
    // circular — the final document's own hash necessarily depends on bytes
    // that include this very certificate page, so it's computed after
    // save() below and stored on the contract instance instead (viewable in
    // the admin preview), not printed on the page it would be hashing.
    if (instance.template_pdf_sha256) cert.keyValue('Starting Document Hash (SHA-256)', instance.template_pdf_sha256, { size: 7.5 });
    cert.gap(10);
    cert.divider();

    cert.eyebrow('Signers');
    for (const p of updatedParties) {
      const roleWord = roleWordFor(p.role, template.type, partyRoles);
      cert.keyValue(roleWord, `${p.name}${p.phone ? ` · ${p.phone}` : ''}`);
      cert.line(p.signature_data_url ? 'Signed electronically' : 'No signature required for this role', {
        size: 9,
        color: p.signature_data_url ? SUCCESS : SLATE_DIM,
      });
      cert.gap(6);
    }
    cert.gap(4);
    cert.divider();

    cert.eyebrow('Complete Event Timeline');
    if (!auditEvents?.length) {
      cert.line('No audit events were recorded for this envelope.', { size: 9 });
    }
    for (const evt of auditEvents ?? []) {
      // 'delegated' is the one event type whose party_id no longer points
      // at a meaningful "who" by cert time — the row's own name has already
      // been overwritten to the new signer, so partyLabelById would
      // misattribute the handoff to the person it was handed TO. detail
      // (captured at the moment of the handoff, before the overwrite) is
      // the only accurate record of who actually forwarded to whom.
      const who =
        evt.event_type === 'delegated' && evt.detail
          ? 'Forwarded'
          : evt.party_id
            ? (partyLabelById.get(evt.party_id) ?? 'Unknown party')
            : 'System';
      let label = evt.event_type === 'delegated' && evt.detail ? evt.detail : EVENT_LABELS[evt.event_type] ?? evt.event_type;
      if (evt.event_type === 'field_signed' && evt.field_id) {
        const fieldLabel = fieldLabelById.get(evt.field_id);
        if (fieldLabel) label = `Signed "${fieldLabel}"`;
      }
      cert.line(who, { size: 9.5, color: INK, bold: true });
      cert.line(`${label} — ${formatWhen(evt.created_at)}`, { size: 9 });
      if (evt.ip_address) cert.line(`IP Address: ${evt.ip_address}`, { size: 8, color: SLATE_DIM });
      if (evt.user_agent) cert.line(`Device: ${evt.user_agent}`, { size: 8, color: SLATE_DIM });
      cert.gap(7);
    }
    cert.gap(4);
    cert.divider();

    // A tickmark's value is the literal string "true"/"false" — only a
    // checked box counts as "completed" here, same as the signing page's
    // own required-field gating. A signature field's value is a full image
    // data URL, useless printed verbatim, so it gets a plain "Signed
    // electronically" line instead of its raw value like every other type.
    const fieldsWithValues = (template.fields ?? []).filter((f) => {
      const v = fieldValues[f.id];
      if (!v) return false;
      if (f.type === 'tickmark') return v === 'true';
      return true;
    });
    if (fieldsWithValues.length > 0) {
      cert.eyebrow('Fields Completed');
      const fieldsByRole = new Map<string, ContractField[]>();
      for (const f of fieldsWithValues) {
        if (!fieldsByRole.has(f.role)) fieldsByRole.set(f.role, []);
        fieldsByRole.get(f.role)!.push(f);
      }
      for (const [role, fields] of fieldsByRole) {
        const p = partyByRole.get(role);
        const roleWord = roleWordFor(role, template.type, partyRoles);
        cert.line(`${roleWord}${p ? ` — ${p.name}` : ''}`, { size: 9.5, color: INK, bold: true });
        const signedEvent = p ? signedEventByParty.get(p.id) : undefined;
        if (signedEvent) {
          cert.line(`Recorded at time of signing — ${formatWhen(signedEvent.at)}`, { size: 8, color: SLATE_DIM });
          if (signedEvent.ip) cert.line(`IP Address: ${signedEvent.ip}`, { size: 8, color: SLATE_DIM });
        }
        cert.gap(3);
        for (const f of fields) {
          const displayValue = f.type === 'signature' ? 'Signed electronically' : f.type === 'tickmark' ? 'Checked' : fieldValues[f.id];
          cert.keyValue(f.label, displayValue, { size: 9 });
          // A signature field gets its own field-level timestamp/IP right
          // underneath it when one was actually recorded — the one place in
          // this certificate where "completed" means something more precise
          // than "sometime during this party's single Sign action."
          if (f.type === 'signature') {
            const fieldEvent = fieldSignedEventByFieldId.get(f.id);
            if (fieldEvent) {
              cert.line(`Signed — ${formatWhen(fieldEvent.at)}${fieldEvent.ip ? ` · IP ${fieldEvent.ip}` : ''}`, { size: 7.5, color: SLATE_DIM });
            }
          }
        }
        cert.gap(8);
      }
    }

    cert.finalize('Bluebird Acquisition — Certificate of Completion');

    const finalBytes = await pdfDoc.save();
    const finalPath = `contracts/${instance.id}/signed-${Date.now()}.pdf`;
    const { error: uploadErr } = await admin.storage.from('blue-docs').upload(finalPath, finalBytes, { contentType: 'application/pdf' });
    if (uploadErr) throw uploadErr;

    const finalHashBuffer = await crypto.subtle.digest('SHA-256', finalBytes);
    const finalSha256 = Array.from(new Uint8Array(finalHashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');

    const { error: finalizeErr } = await admin
      .from('contract_instances')
      .update({ status: 'signed', final_storage_path: finalPath, completed_at: new Date().toISOString(), final_pdf_sha256: finalSha256 })
      .eq('id', instance.id);
    if (finalizeErr) throw finalizeErr;

    // Push to every admin's device the moment the last signature lands —
    // same fan-out shape as decline-signature's own notification. Wrapped so
    // a notification-insert hiccup never costs the signer their completed
    // contract (everything above this point already succeeded).
    try {
      const { data: admins } = await admin.from('profiles').select('id').eq('role', 'admin');
      if (admins?.length) {
        await admin.from('lc_notifications').insert(
          admins.map((a) => ({
            user_id: a.id,
            type: 'contract_signed',
            title: 'Contract fully signed',
            body: `${instance.name ?? 'A document'}${instance.property_address ? ` — ${instance.property_address}` : ''} is complete.`,
          })),
        );
      }
    } catch (notifyErr) {
      console.error('contract_signed notification failed:', notifyErr);
    }

    // Notify everyone it's done, each with their own link back to their
    // signing page — that page shows the download button once it sees the
    // contract's now-'signed' status (see SignContractPage's fullyDone).
    // The email additionally carries finalBytes itself as a PDF attachment
    // (already on hand from the certificate build above, no extra fetch),
    // so a signer has their copy in hand without needing to click through.
    // Each send is wrapped individually so one party's Zoom hiccup doesn't
    // cost every other party their text, and a failed email attachment
    // doesn't cost them the SMS.
    for (const p of updatedParties) {
      const partyLink = `https://www.bluebirdacquisition.com/crm/sign/${p.access_token}`;
      if (p.send_sms && p.phone) {
        try {
          await sendBlueDocsSms(p.phone, COMPLETED_MESSAGE(partyLink));
        } catch (smsErr) {
          console.error(`Blue Docs completion SMS failed for party ${p.id}:`, smsErr);
        }
      }
      if (p.send_email && p.email) {
        try {
          const isCashDeal = instance.template_id === CASH_DEAL_TEMPLATE_ID;
          const html = signedCompleteEmailHtml({
            recipientName: p.name,
            address: instance.property_address ?? '',
            link: partyLink,
            documentId: instance.id,
            signedRows: buildSignedRows(p, updatedParties),
            titleCompany: isCashDeal ? fieldValues[CASH_DEAL_FIELD_IDS.titleCompany] || undefined : undefined,
            closingDate: isCashDeal && fieldValues[CASH_DEAL_FIELD_IDS.closingDate]
              ? formatDateOnly(fieldValues[CASH_DEAL_FIELD_IDS.closingDate])
              : undefined,
            emdAmount: isCashDeal ? fieldValues[CASH_DEAL_FIELD_IDS.emdAmount] || undefined : undefined,
          });
          await sendEmail(p.email, `Contract signed - ${instance.property_address ?? 'your property'}`, html, [
            { filename: 'Signed Contract.pdf', contentType: 'application/pdf', encoding: 'binary', content: finalBytes },
          ]);
        } catch (emailErr) {
          console.error(`Blue Docs completion email failed for party ${p.id}:`, emailErr);
        }
      }
    }

    return json({ ok: true, allSigned: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unexpected error' }, 500);
  }
});
