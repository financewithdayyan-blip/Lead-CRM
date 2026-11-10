// Edge Function: send-disposition-packet
//
// Bulk-sends a deal packet link to a set of cash buyers selected on the
// Disposition map (lasso or manual pick), by SMS, email, or both. Admin-
// only, real logged-in session — same posture as send-buyer-sms and
// create-contract-instance. One durable record per send (disposition_sends)
// plus one row per buyer actually reached (disposition_send_recipients),
// so the Deal Room can later show exactly who got this specific packet.
//
// SMS reuses send-buyer-sms's own Zoom Phone call shape (same 6-number
// pool, same pinned-number-wins rule); email reuses send-packet-email's
// SMTP client. Duplicated rather than imported — these are separate Deno
// edge functions, each deployed independently, same as every other
// cross-function duplication already in this codebase (see send-sms's own
// note on render()).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';
import { encode as base64Encode } from 'https://deno.land/std@0.173.0/encoding/base64.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const ZOOM_ACCOUNT_ID = Deno.env.get('ZOOM_ACCOUNT_ID')!;
const ZOOM_CLIENT_ID = Deno.env.get('ZOOM_CLIENT_ID')!;
const ZOOM_CLIENT_SECRET = Deno.env.get('ZOOM_CLIENT_SECRET')!;

const SMTP_HOST = Deno.env.get('SMTP_HOST')!;
const SMTP_PORT = Number(Deno.env.get('SMTP_PORT') ?? '465');
const SMTP_USER = Deno.env.get('SMTP_USER')!;
const SMTP_PASS = Deno.env.get('SMTP_PASS')!;
const SMTP_FROM_EMAIL = Deno.env.get('SMTP_FROM_EMAIL')!;
const SMTP_FROM_NAME = Deno.env.get('SMTP_FROM_NAME') ?? 'Bluebird Acquisition';

const NUMBERS: Record<string, { phone: string; email: string }> = {
  '1': { phone: Deno.env.get('ZOOM_FROM_NUMBER') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL') ?? '' },
  '2': { phone: Deno.env.get('ZOOM_FROM_NUMBER_2') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL_2') ?? '' },
  '3': { phone: Deno.env.get('ZOOM_FROM_NUMBER_3') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL_3') ?? '' },
  '4': { phone: Deno.env.get('ZOOM_FROM_NUMBER_4') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL_4') ?? '' },
  '5': { phone: Deno.env.get('ZOOM_FROM_NUMBER_5') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL_5') ?? '' },
  '6': { phone: Deno.env.get('ZOOM_FROM_NUMBER_6') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL_6') ?? '' },
};
const DEFAULT_SMS_KEY = '1';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

const FETCH_TIMEOUT_MS = 15_000;

/** Same {{first_name}}-style placeholder convention as send-sms/render(). */
function render(template: string, buyer: Record<string, unknown>): string {
  return template
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, key: string) => {
      const v = buyer[key.toLowerCase()];
      return v == null ? '' : String(v);
    })
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function toE164(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

async function zoomToken(): Promise<string> {
  const basic = btoa(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`);
  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(ZOOM_ACCOUNT_ID)}`,
    { method: 'POST', headers: { Authorization: `Basic ${basic}` }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
  );
  if (!res.ok) throw new Error(`Zoom auth failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token;
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

function emailHtml(bodyText: string): string {
  const escaped = bodyText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  return `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 4px rgba(11,30,51,.04),0 14px 32px -16px rgba(11,30,51,.16);">
<tr><td style="padding:22px 28px;border-bottom:1px solid #e2e8f0;font-size:14px;font-weight:700;color:#0B1E33;">Bluebird Acquisition</td></tr>
<tr><td style="padding:28px;font-size:14px;line-height:1.6;color:#0B1E33;">${escaped}</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

async function sendEmail(to: string, subject: string, html: string) {
  const client = new SMTPClient({
    connection: { hostname: SMTP_HOST, port: SMTP_PORT, tls: true, auth: { username: SMTP_USER, password: SMTP_PASS } },
  });
  try {
    const b64 = base64Encode(html).match(/.{1,76}/g)?.join('\r\n') ?? base64Encode(html);
    await client.send({
      from: `${SMTP_FROM_NAME} <${SMTP_FROM_EMAIL}>`,
      to,
      subject,
      mimeContent: [{ mimeType: 'text/html; charset="utf-8"', content: b64, transferEncoding: 'base64' }],
    });
  } finally {
    await client.close();
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await callerClient.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return json({ error: 'Not signed in.' }, 401);

    const { data: profile } = await admin.from('profiles').select('role').eq('id', userId).single();
    if (profile?.role !== 'admin') return json({ error: 'Admins only.' }, 403);

    const { packetId, buyerIds, channel, message, subject } = await req.json();
    if (!packetId || !Array.isArray(buyerIds) || buyerIds.length === 0 || typeof message !== 'string' || !message.trim()) {
      return json({ error: 'packetId, buyerIds, and a non-empty message are required.' }, 400);
    }
    if (!['sms', 'email', 'both'].includes(channel)) return json({ error: 'channel must be sms, email, or both.' }, 400);

    const { data: packet } = await admin.from('deal_packets').select('id, lead_id').eq('id', packetId).single();
    if (!packet) return json({ error: 'Deal packet not found.' }, 404);

    const { data: buyers } = await admin
      .from('cash_buyers')
      .select('id, name, phone, email, sms_opted_out, assigned_sms_number')
      .in('id', buyerIds);
    if (!buyers || buyers.length === 0) return json({ error: 'No matching buyers found.' }, 404);

    let zoomTokenCache: string | null = null;
    async function getZoomToken(): Promise<string> {
      if (!zoomTokenCache) zoomTokenCache = await zoomToken();
      return zoomTokenCache;
    }

    const results: Array<{ buyerId: string; channelUsed: 'sms' | 'email'; status: 'sent' | 'failed'; error?: string }> = [];

    for (const buyer of buyers) {
      const firstName = (buyer.name ?? '').split(' ')[0] || 'there';
      const personalized = render(message, { first_name: firstName, name: buyer.name });

      const wantsSms = channel === 'sms' || channel === 'both';
      const wantsEmail = channel === 'email' || channel === 'both';

      if (wantsSms && buyer.phone && !buyer.sms_opted_out) {
        const toPhone = toE164(buyer.phone);
        const pinned = buyer.assigned_sms_number as string | null;
        const effectiveKey = pinned && NUMBERS[pinned]?.phone ? pinned : DEFAULT_SMS_KEY;
        const sender = NUMBERS[effectiveKey];
        try {
          if (!toPhone) throw new Error('Invalid phone number');
          if (!sender?.phone) throw new Error(`Sending number "${effectiveKey}" not configured`);
          const token = await getZoomToken();
          await sendZoomSms(sender.phone, toPhone, personalized, token);
          await admin.from('buyer_messages').insert({
            buyer_id: buyer.id,
            direction: 'outbound',
            channel: 'sms',
            body: personalized,
            from_phone: sender.phone,
            to_phone: toPhone,
            sent_from: effectiveKey,
            user_id: userId,
          });
          if (!pinned) await admin.from('cash_buyers').update({ assigned_sms_number: effectiveKey }).eq('id', buyer.id);
          results.push({ buyerId: buyer.id, channelUsed: 'sms', status: 'sent' });
        } catch (e) {
          results.push({ buyerId: buyer.id, channelUsed: 'sms', status: 'failed', error: e instanceof Error ? e.message : String(e) });
        }
      }

      if (wantsEmail && buyer.email) {
        try {
          await sendEmail(buyer.email, subject || 'New off-market deal', emailHtml(personalized));
          await admin.from('buyer_messages').insert({
            buyer_id: buyer.id,
            direction: 'outbound',
            channel: 'email',
            body: personalized,
            user_id: userId,
          });
          results.push({ buyerId: buyer.id, channelUsed: 'email', status: 'sent' });
        } catch (e) {
          results.push({ buyerId: buyer.id, channelUsed: 'email', status: 'failed', error: e instanceof Error ? e.message : String(e) });
        }
      }
    }

    const { data: sendRow, error: sendErr } = await admin
      .from('disposition_sends')
      .insert({
        packet_id: packetId,
        lead_id: packet.lead_id,
        created_by: userId,
        channel,
        message: message.trim(),
        recipient_count: results.filter((r) => r.status === 'sent').length,
      })
      .select('id')
      .single();
    if (sendErr) throw sendErr;

    if (results.length > 0) {
      await admin.from('disposition_send_recipients').insert(
        results.map((r) => ({
          send_id: sendRow.id,
          buyer_id: r.buyerId,
          channel_used: r.channelUsed,
          status: r.status,
          error: r.error ?? null,
        })),
      );
    }

    return json({
      ok: true,
      sendId: sendRow.id,
      sent: results.filter((r) => r.status === 'sent').length,
      failed: results.filter((r) => r.status === 'failed').length,
      results,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
