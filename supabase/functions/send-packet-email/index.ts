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

// ── Branded shell — table-based, every style inlined, matching the Blue Docs
// contract emails so every email this company sends looks like one system. ──
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
<p style="margin:0;font-size:11px;line-height:1.6;color:#8693A1;">This email was sent by Bluebird Acquisition about an off-market property deal. If the button above doesn't open, use the link at the bottom of this email.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function factCallout(facts: Array<[string, string]>): string {
  const cells = facts
    .map(
      ([label, value]) => `<td style="padding:0 14px 0 0;">
<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#8693A1;">${label}</div>
<div style="margin-top:2px;font-size:14px;font-weight:600;color:#0B1E33;">${value}</div>
</td>`,
    )
    .join('');
  return `<div style="margin:20px 0;padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table>
</div>`;
}

function ctaButton(link: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#C9A24B;border-radius:10px;">
<a href="${link}" style="display:inline-block;padding:14px 28px;font-size:14px;font-weight:700;color:#0B1E33;text-decoration:none;">${label}</a>
</td></tr></table>`;
}

function fallbackLink(link: string): string {
  return `<p style="margin:20px 0 0;font-size:11.5px;color:#8693A1;word-break:break-all;">Or paste this link into your browser:<br><a href="${link}" style="color:#1568A8;">${link}</a></p>`;
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
    const { packetId, email, note } = body as { packetId: string; email: string; note?: string };
    if (!packetId || !email?.trim()) return json({ error: 'Missing packetId or email.' }, 400);
    if (!isValidEmail(email)) return json({ error: 'That email address doesn\'t look valid.' }, 400);

    // RLS-scoped to the caller — returns nothing if they don't own this
    // packet and aren't an overseeing admin, exactly like opening it in the app.
    const { data: packet, error: packetErr } = await callerClient
      .from('deal_packets')
      .select('id, lead_id, slug, status, prop_type, city, state, beds, baths, sqft, deal_types')
      .eq('id', packetId)
      .single();
    if (packetErr || !packet) return json({ error: 'Packet not found, or you don\'t have access to it.' }, 404);
    if (packet.status !== 'active') return json({ error: 'Only an active packet can be emailed — activate it first.' }, 400);

    const link = `https://www.bluebirdacquisition.com/crm/deal/${packet.slug}`;
    const propType = packet.prop_type || 'Property';
    const area = [packet.city, packet.state].filter(Boolean).join(', ');
    const dealTypeLabels = ((packet.deal_types ?? []) as string[]).map((t) => DEAL_TYPE_LABELS[t]).filter(Boolean);

    const facts: Array<[string, string]> = [['Property', propType]];
    if (area) facts.push(['Area', area]);
    if (packet.beds != null || packet.baths != null) {
      facts.push(['Beds / Baths', `${packet.beds ?? '—'} / ${packet.baths ?? '—'}`]);
    }
    if (packet.sqft != null) facts.push(['Sqft', String(packet.sqft)]);
    if (dealTypeLabels.length > 0) facts.push(['Structure', dealTypeLabels.join(', ')]);

    const noteHtml = note?.trim()
      ? `<p style="margin:14px 0 0;font-size:14px;line-height:1.6;color:#45566B;">${note.trim()}</p>`
      : '';

    const html = emailShell(
      `New off-market deal${area ? ` in ${area}` : ''}`,
      `<p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#C9A24B;">Off-Market Deal</p>
<h1 style="margin:6px 0 0;font-size:20px;font-weight:700;color:#0B1E33;">${propType}${area ? ` — ${area}` : ''}</h1>
<p style="margin:14px 0 0;font-size:14px;line-height:1.6;color:#45566B;">Thought you'd want a look at this one. Full details, photos, comps and numbers are in the deal packet below.</p>
${noteHtml}
${factCallout(facts)}
${ctaButton(link, 'View Full Deal Packet')}
<p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#45566B;">Let me know if you want to move on it.<br>Thanks,<br>Dayyan</p>
${fallbackLink(link)}`,
    );

    await sendEmail(
      email.trim(),
      `Off-Market Deal — ${propType}${area ? ` in ${area}` : ''}`,
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
