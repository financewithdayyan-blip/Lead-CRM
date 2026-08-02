// Edge Function: send-sms
//
// Bulk cold outreach over Zoom Phone. Admin-only.
//
// The sending window, the rolling limits and the opt-out check all live here
// rather than in the client, because the client can be bypassed and none of
// these are cosmetic — sending outside the window or to an opted-out number is
// a compliance problem, not a UX one.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ZOOM_ACCOUNT_ID = Deno.env.get('ZOOM_ACCOUNT_ID')!;
const ZOOM_CLIENT_ID = Deno.env.get('ZOOM_CLIENT_ID')!;
const ZOOM_CLIENT_SECRET = Deno.env.get('ZOOM_CLIENT_SECRET')!;

/** The two sending identities, selectable per send. */
const NUMBERS: Record<string, { phone: string; email: string; label: string }> = {
  '1': {
    phone: Deno.env.get('ZOOM_FROM_NUMBER') ?? '',
    email: Deno.env.get('ZOOM_USER_EMAIL') ?? '',
    label: Deno.env.get('ZOOM_LABEL') ?? 'Number 1',
  },
  '2': {
    phone: Deno.env.get('ZOOM_FROM_NUMBER_2') ?? '',
    email: Deno.env.get('ZOOM_USER_EMAIL_2') ?? '',
    label: Deno.env.get('ZOOM_LABEL_2') ?? 'Number 2',
  },
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Sending window ──────────────────────────────────────────────────────────

/**
 * Bulk cold outreach is allowed 7pm-6am Pakistan time (UTC+5), which is
 * 14:00-01:00 UTC. That lands at 9am-8pm US Eastern and 8am-7pm Central, so
 * every market stays inside 8am-9pm local.
 *
 * Applies to cold outreach only. AI auto-replies answer whenever the lead
 * writes, since replying to someone who just texted you is not cold contact.
 */
export function withinSendWindow(now = new Date()): boolean {
  const utcHour = now.getUTCHours();
  // 14:00-23:59 UTC, or 00:00-00:59 UTC (the window crosses midnight UTC).
  return utcHour >= 14 || utcHour < 1;
}

// ── Zoom auth ───────────────────────────────────────────────────────────────

// Cached for the life of the instance. Zoom tokens last an hour; re-minting one
// per message would be both slow and needlessly rate-limited.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function zoomToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;

  const basic = btoa(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`);
  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(ZOOM_ACCOUNT_ID)}`,
    { method: 'POST', headers: { Authorization: `Basic ${basic}` } },
  );

  if (!res.ok) throw new Error(`Zoom auth failed (${res.status}): ${await res.text()}`);

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    // 60s of slack so a token can't expire mid-burst.
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000,
  };
  return cachedToken.token;
}

// Zoom user ids never change, so cache them for the instance too.
const userIdCache = new Map<string, string>();

async function zoomUserId(email: string, token: string): Promise<string> {
  const hit = userIdCache.get(email);
  if (hit) return hit;

  const res = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Zoom user lookup failed for ${email} (${res.status}): ${await res.text()}`);

  const data = await res.json();
  userIdCache.set(email, data.id);
  return data.id;
}

async function sendZoomSms(fromPhone: string, toPhone: string, message: string, token: string) {
  const res = await fetch('https://api.zoom.us/v2/phone/sms/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: { phone_number: fromPhone },
      to_members: [{ phone_number: toPhone }],
      message,
    }),
  });

  if (!res.ok) throw new Error(`Zoom send failed (${res.status}): ${await res.text()}`);
  return res.json().catch(() => ({}));
}

// ── Message rendering ───────────────────────────────────────────────────────

/** Replaces {{first_name}}-style placeholders. Unknown tokens resolve to ''. */
function render(template: string, lead: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, key: string) => {
    const v = lead[key.toLowerCase()];
    return v == null ? '' : String(v);
  }).replace(/\s{2,}/g, ' ').trim();
}

/** E.164 for Zoom. Ten digits get a US country code; eleven starting with 1 already have one. */
function toE164(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Identify the caller and require admin.
    const { data: userData } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
    const userId = userData?.user?.id;
    if (!userId) return json({ error: 'Not signed in.' }, 401);

    const { data: profile } = await admin.from('profiles').select('role').eq('id', userId).single();
    if (profile?.role !== 'admin') return json({ error: 'Admins only.' }, 403);

    const body = await req.json();
    const {
      leadIds = [],
      templatesByTag = {},
      defaultTemplate = '',
      fromKey = '1',
      perMessageDelayMs = 1200,
      dailyLimit = 0,
    } = body as {
      leadIds: string[];
      templatesByTag: Record<string, string>;
      defaultTemplate: string;
      fromKey: string;
      perMessageDelayMs?: number;
      dailyLimit?: number;
    };

    const from = NUMBERS[fromKey];
    if (!from?.phone || !from.email) {
      return json({ error: `Sending number "${fromKey}" is not configured.` }, 400);
    }
    if (!leadIds.length) return json({ error: 'No leads selected.' }, 400);

    // The window restricts bulk cold outreach only. A single send — a manual
    // reply to an already-open conversation, or a one-off text to one lead —
    // is never cold in the same sense and always goes through, checked before
    // anything else so a blocked run costs no Zoom calls.
    if (leadIds.length > 1 && !withinSendWindow()) {
      return json(
        {
          error:
            'Outside the sending window. Bulk outreach runs 7pm-6am Pakistan time (9am-8pm US Eastern).',
        },
        422,
      );
    }

    if (dailyLimit > 0) {
      const { data: used } = await admin.rpc('sends_in_window', { p_sent_from: from.phone, p_hours: 24 });
      const remaining = dailyLimit - Number(used ?? 0);
      if (remaining <= 0) {
        return json(
          { error: `${from.label} has already sent ${used} messages in the last 24 hours (limit ${dailyLimit}).` },
          422,
        );
      }
      if (leadIds.length > remaining) {
        return json(
          { error: `Only ${remaining} sends left on ${from.label} in this rolling 24 hours. Select fewer leads.` },
          422,
        );
      }
    }

    // Tag names come along so the right template can be chosen per lead.
    const { data: leads, error: leadErr } = await admin
      .from('leads')
      .select('id, first_name, last_name, phone, phone_norm, address, city, state, zip, opted_out, stage, lead_tags(tag_id, tags(name))')
      .in('id', leadIds);
    if (leadErr) throw leadErr;

    const token = await zoomToken();
    // Resolved even though the send endpoint takes the number, because Zoom
    // rejects sends from a number the authed user doesn't own.
    await zoomUserId(from.email, token);

    const sent: string[] = [];
    const skipped: { leadId: string; reason: string }[] = [];
    const failed: { leadId: string; error: string }[] = [];

    for (const lead of leads ?? []) {
      if (lead.opted_out) {
        skipped.push({ leadId: lead.id, reason: 'opted out' });
        continue;
      }

      const to = toE164(lead.phone ?? '');
      if (!to) {
        skipped.push({ leadId: lead.id, reason: 'no usable phone number' });
        continue;
      }

      // First tag with a template wins; otherwise the default.
      const tagNames: string[] = (lead.lead_tags ?? [])
        .map((lt: any) => lt.tags?.name)
        .filter(Boolean);
      const template = tagNames.map((n) => templatesByTag[n]).find(Boolean) ?? defaultTemplate;
      if (!template) {
        skipped.push({ leadId: lead.id, reason: 'no template for this lead\'s tags' });
        continue;
      }

      const message = render(template, {
        first_name: lead.first_name,
        last_name: lead.last_name,
        address: lead.address,
        city: lead.city,
        state: lead.state,
        zip: lead.zip,
      });

      try {
        await sendZoomSms(from.phone, to, message, token);

        // Logged before anything else so a later failure can never lose the
        // record that this number was contacted.
        await admin.from('send_log').insert({
          user_id: userId,
          lead_id: lead.id,
          phone: to,
          phone_norm: lead.phone_norm,
          sent_from: from.phone,
          body: message,
        });

        // Cold leads advance to Contacted. Anything further along keeps its
        // stage — a lead already in Negotiation shouldn't regress.
        if (lead.stage === 'new') {
          await admin.from('leads').update({ stage: 'contacted' }).eq('id', lead.id);
        }

        await admin.from('lead_activities').insert({
          lead_id: lead.id,
          user_id: userId,
          type: 'sms',
          body: message,
          meta: { direction: 'outbound', from: from.phone, to, label: from.label },
        });

        sent.push(lead.id);
      } catch (e) {
        failed.push({ leadId: lead.id, error: e instanceof Error ? e.message : String(e) });
      }

      if (perMessageDelayMs > 0) await sleep(perMessageDelayMs);
    }

    return json({ sent: sent.length, skipped, failed, from: from.label });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
