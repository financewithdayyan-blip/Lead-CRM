// Edge Function: send-packet-email
//
// Emails a deal packet's shareable link to an investor. Admin-only, real
// logged-in session — same posture as create-contract-instance (caller-
// scoped client for auth.getUser() and the RLS-respecting packet lookup,
// service-role client only for the SMTP send itself). Looking the packet up
// through the caller-scoped client rather than trusting a client-supplied
// slug/summary is what stops any signed-in caller from emailing an arbitrary
// link, branded as us, for a packet they don't actually own or oversee.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';
import { encode as base64Encode } from 'https://deno.land/std@0.173.0/encoding/base64.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

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

function isValidEmail(raw: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw.trim());
}

// Duplicated rather than imported — DEAL_TYPE_CONFIG in src/types/domain.ts
// is a frontend module Deno can't reach; kept to the same 4 keys/labels.
const DEAL_TYPE_LABELS: Record<string, string> = {
  cash: 'Cash Offer',
  subject_to: 'Subject-To',
  novation: 'Novation',
  creative: 'Creative Finance',
};

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
    await client.send({ from: `${SMTP_FROM_NAME} <${SMTP_FROM_EMAIL}>`, to, subject, mimeContent: toMimeHtml(html) });
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
// Same public-facing number used on every other Bluebird-branded email (see
// create-contract-instance/submit-signature) — one person, one number, kept
// consistent across every template rather than introducing a second line.
const AGENT_PHONE_DISPLAY = formatPhoneDisplay(Deno.env.get('ZOOM_FROM_NUMBER_2') ?? '');

function shortRef(documentId: string): string {
  return documentId.slice(0, 8).toUpperCase();
}

function formatMoney(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// ── Branded shell — table-based, every style inlined, matching the Blue Docs
// contract emails (create-contract-instance/submit-signature) so every email
// this company sends looks like one system: a plain white header with a
// "Ref" on the right, and a two-line footer note. -webkit-text-size-adjust:
// 100% (style block + inline on <body>, belt and suspenders since some
// clients strip one or the other) is the fix for the footer paragraph
// splitting apart with a huge blank gap in the middle — iOS Mail
// auto-inflates small text (that paragraph is 11px) it decides is "too
// small to read," reflowing it at an inconsistent effective size unless
// this is explicitly turned off. ──
function emailShell(preheader: string, bodyHtml: string, opts: { documentId: string; footerNote: string }): string {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bluebird Acquisition</title>
<style>body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}</style>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 4px rgba(11,30,51,.04),0 14px 32px -16px rgba(11,30,51,.16);border-collapse:collapse;">
<tr><td style="padding:22px 32px;border-bottom:1px solid #e2e8f0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:10px;height:10px;background:#0B1E33;border-radius:2px;"></td>
<td style="padding-left:8px;font-size:14px;font-weight:700;color:#0B1E33;">Bluebird Acquisition</td>
</tr></table>
</td>
<td align="right" style="vertical-align:middle;font-size:11px;color:#8693A1;">Deal ${shortRef(opts.documentId)}</td>
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
 * value right. Same shape as the Blue Docs contract emails' Property/
 * Purchase price rows. */
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });

    const { data: userData } = await callerClient.auth.getUser();
    if (!userData?.user?.id) return json({ error: 'Not signed in.' }, 401);

    const body = await req.json();
    const { packetId, email, note, recipientName, offerDeadline } = body as {
      packetId: string;
      email: string;
      note?: string;
      recipientName?: string;
      offerDeadline?: string;
    };
    if (!packetId || !email?.trim()) return json({ error: 'Missing packetId or email.' }, 400);
    if (!isValidEmail(email)) return json({ error: 'That email address doesn\'t look valid.' }, 400);

    const normalizedEmail = email.trim().toLowerCase();
    const { data: suppressed } = await admin
      .from('packet_email_unsubscribes')
      .select('email')
      .eq('email', normalizedEmail)
      .maybeSingle();
    if (suppressed) return json({ error: `${email.trim()} has unsubscribed from deal-packet emails.` }, 400);

    // RLS-scoped to the caller — returns nothing if they don't own this
    // packet and aren't an overseeing admin, exactly like opening it in the app.
    const { data: packet, error: packetErr } = await callerClient
      .from('deal_packets')
      .select('id, lead_id, slug, status, prop_type, city, state, beds, baths, sqft, deal_types, purchase_price, assignment_fee, arv')
      .eq('id', packetId)
      .single();
    if (packetErr || !packet) return json({ error: 'Packet not found, or you don\'t have access to it.' }, 404);
    if (packet.status !== 'active') return json({ error: 'Only an active packet can be emailed — activate it first.' }, 400);

    // Repair total isn't on deal_packets itself — summed from its own line
    // items, same source PacketTab/DealPacketBuilder use for the repair
    // breakdown shown in the app.
    const { data: repairRows } = await callerClient.from('packet_repairs').select('cost').eq('packet_id', packet.id);
    const repairTotal = (repairRows ?? []).reduce((sum, r) => sum + (Number(r.cost) || 0), 0);

    // Every link in this email — CTA button and the plaintext fallback —
    // routes through track-packet-email-click rather than straight at the
    // packet, and a hidden pixel points at track-packet-email-open, so
    // "opened the email" / "opened the link" on the packet's analytics are
    // real server-recorded facts, not something the client claims. Row
    // must exist before the email goes out — a very fast open shouldn't be
    // able to race a tracking_token that doesn't exist yet. The same token
    // also backs the Unsubscribe link, resolving back to this exact to_email
    // server-side (see unsubscribe-packet-email) rather than trusting
    // whatever address a forwarded/tampered link claims.
    const trackingToken = crypto.randomUUID();
    const { error: shareErr } = await admin.from('packet_email_shares').insert({
      packet_id: packet.id,
      user_id: userData.user.id,
      to_email: email.trim(),
      note: note?.trim() || null,
      tracking_token: trackingToken,
    });
    if (shareErr) throw shareErr;

    const link = `${SUPABASE_URL}/functions/v1/track-packet-email-click?t=${trackingToken}`;
    const pixelUrl = `${SUPABASE_URL}/functions/v1/track-packet-email-open?t=${trackingToken}`;
    const unsubscribeLink = `${SUPABASE_URL}/functions/v1/unsubscribe-packet-email?t=${trackingToken}`;
    const propType = packet.prop_type || 'Property';
    const area = [packet.city, packet.state].filter(Boolean).join(', ');
    const dealTypeLabels = ((packet.deal_types ?? []) as string[]).map((t) => DEAL_TYPE_LABELS[t]).filter(Boolean);
    const firstName = recipientName?.trim() ? recipientName.trim().split(' ')[0] : null;

    // Street-level address is deliberately never put in this email — same
    // boundary the public packet page itself enforces (see
    // 0147_packet_address_reveal_from_lead's "no longer disclose an exact
    // location under any circumstance" until a visitor passes the
    // lead-capture gate). City/state is as specific as any Bluebird email
    // ever gets before that gate.
    const headline = `${propType}${area ? ` — ${area}` : ''}`;

    // Same "quoted price" the public packet page itself shows as Asking
    // Price (see get_public_packet) — purchase_price is what Bluebird pays
    // the seller, never shown to an investor on its own, since that would
    // expose the assignment fee as the gap between this email's number and
    // the packet's. Always folded in regardless of show_assignment_fee,
    // which only controls whether the fee is ALSO broken out as its own
    // line — same as the RPC.
    const quotedPrice = packet.purchase_price != null ? packet.purchase_price + (packet.assignment_fee ?? 0) : null;

    const rows: Array<{ label: string; value: string }> = [];
    if (quotedPrice != null) rows.push({ label: 'Asking price', value: formatMoney(quotedPrice) });
    if (packet.arv != null) rows.push({ label: 'Estimated ARV', value: formatMoney(packet.arv) });
    if ((repairRows ?? []).length > 0) rows.push({ label: 'Estimated repairs', value: formatMoney(repairTotal) });
    const bedsBaths = packet.beds != null || packet.baths != null ? `${packet.beds ?? '—'}bd / ${packet.baths ?? '—'}ba` : '';
    const sqftStr = packet.sqft != null ? `${Number(packet.sqft).toLocaleString()} sqft` : '';
    const propertyDetail = [propType, [bedsBaths, sqftStr].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
    if (propertyDetail) rows.push({ label: 'Property', value: propertyDetail });
    if (dealTypeLabels.length > 0) rows.push({ label: 'Structure', value: dealTypeLabels.join(', ') });

    const noteHtml = note?.trim()
      ? `<p style="margin:14px 0 0;font-size:14px;line-height:1.6;color:#45566B;">${note.trim()}</p>`
      : '';
    const deadlineHtml = offerDeadline?.trim()
      ? `<p style="margin:14px 0 0;font-size:12.5px;line-height:1.6;color:#8693A1;">We're taking offers until ${offerDeadline.trim()}. Serious buyers with proof of funds get first look.</p>`
      : '';

    const bodyHtml = `
<p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#1568A8;">New Off-Market Deal</p>
<h1 style="margin:0;font-size:21px;line-height:1.35;font-weight:700;color:#0B1E33;">${headline}</h1>
<p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:#45566B;">Hi${firstName ? ` ${firstName}` : ' there'},</p>
<p style="margin:10px 0 0;font-size:14px;line-height:1.6;color:#45566B;">We just locked up this property and you're one of the first buyers seeing it. The numbers are below. Photos, comps and the repair breakdown are all in the deal packet.</p>
${noteHtml}
${detailTable(rows)}
${ctaButton(link, 'View deal packet')}
${deadlineHtml}
<p style="margin:24px 0 0;font-size:13.5px;line-height:1.6;color:#45566B;">Want to walk it or talk numbers? Call me at ${AGENT_PHONE_DISPLAY} or reply to this email.</p>
<p style="margin:18px 0 0;font-size:13.5px;line-height:1.6;color:#0B1E33;font-weight:600;">${AGENT_NAME}<br><span style="font-weight:400;color:#8693A1;">Dispositions, Bluebird Acquisition</span></p>
<div style="margin:28px 0 0;border-top:1px solid #e2e8f0;"></div>
<p style="margin:16px 0 0;font-size:11.5px;line-height:1.6;color:#8693A1;">Bluebird Acquisition holds this property under contract and is offering an assignment of that contract. ARV and repair figures are estimates; please do your own due diligence before making an offer.</p>
${fallbackLink(link)}
<img src="${pixelUrl}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;" />`;

    const html = emailShell(`New off-market deal${area ? ` in ${area}` : ''}`, bodyHtml, {
      documentId: packet.id,
      footerNote: `You're receiving this because Bluebird Acquisition is sharing an off-market deal with you. <a href="${unsubscribeLink}" style="color:#8693A1;text-decoration:underline;">Unsubscribe</a>`,
    });

    await sendEmail(
      email.trim(),
      `Off-Market Deal - ${propType}${area ? ` in ${area}` : ''}`,
      html,
    );

    if (packet.lead_id) {
      await admin.from('lead_activities').insert({
        lead_id: packet.lead_id,
        user_id: userData.user.id,
        type: 'note',
        body: `Deal packet emailed to ${email.trim()}`,
      });
    }

    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error sending the packet email.' }, 500);
  }
});
