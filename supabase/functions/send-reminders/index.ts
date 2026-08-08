// Edge Function: send-reminders
//
// Daily nudge sweep for leads sitting in Replied or Partial-Qualified
// (initial_contact) — anyone the AI is waiting on for something, with no
// reply in the meantime. Called two ways: by the "Send Reminder Messages"
// button on Kanban (an admin's own JWT) and by a pg_cron schedule (the
// service role key, stored in Vault — see migration 0065/0066). Reads each
// eligible lead's own transcript once and either drafts a short, specific
// reminder about whatever's still outstanding, or — if the lead has already
// promised a specific day — just reschedules silently for that day instead
// of sending anything now.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;

const ZOOM_ACCOUNT_ID = Deno.env.get('ZOOM_ACCOUNT_ID')!;
const ZOOM_CLIENT_ID = Deno.env.get('ZOOM_CLIENT_ID')!;
const ZOOM_CLIENT_SECRET = Deno.env.get('ZOOM_CLIENT_SECRET')!;

const NUMBERS: Record<string, { phone: string; email: string }> = {
  '1': { phone: Deno.env.get('ZOOM_FROM_NUMBER') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL') ?? '' },
  '2': { phone: Deno.env.get('ZOOM_FROM_NUMBER_2') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL_2') ?? '' },
  '3': { phone: Deno.env.get('ZOOM_FROM_NUMBER_3') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL_3') ?? '' },
  '4': { phone: Deno.env.get('ZOOM_FROM_NUMBER_4') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL_4') ?? '' },
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

const FETCH_TIMEOUT_MS = 15_000;
// A single invocation stays well inside the platform's execution-time limit
// (see send-sms's own note on this) even with one Anthropic call per lead —
// any backlog past this just gets picked up on the next run, since a lead
// that wasn't reached keeps next_reminder_at in the past.
const MAX_LEADS_PER_RUN = 50;

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

function humanizePunctuation(text: string): string {
  return text.replace(/\s*[—–]\s*/g, ', ').replace(/\s*;\s*/g, ', ');
}

const LIEN_TAG_NAMES = ['lis pendens', 'pre-foreclosure', 'foreclosure', 'auction'];
const TAX_TAG_NAMES = ['tax delinquent'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Either the cron job (service role key) or an admin clicking the button
  // on Kanban (their own session).
  const authHeader = req.headers.get('Authorization') ?? '';
  const bearer = authHeader.replace('Bearer ', '');
  if (bearer !== SERVICE_ROLE_KEY) {
    const { data: userData } = await admin.auth.getUser(bearer);
    const userId = userData?.user?.id;
    if (!userId) return json({ error: 'Not signed in.' }, 401);
    const { data: profile } = await admin.from('profiles').select('role').eq('id', userId).single();
    if (profile?.role !== 'admin') return json({ error: 'Admins only.' }, 403);
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const todayLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/New_York',
  });

  const { data: eligible, error: leadsErr } = await admin
    .from('leads')
    .select('id, user_id, first_name, address, city, state, phone, stage, next_reminder_at, notes, lead_tags(tags(name))')
    .in('stage', ['replied', 'initial_contact'])
    .eq('opted_out', false)
    .or(`next_reminder_at.is.null,next_reminder_at.lte.${todayIso}`)
    .limit(MAX_LEADS_PER_RUN);
  if (leadsErr) return json({ error: leadsErr.message }, 500);

  let sent = 0;
  let rescheduled = 0;
  let promoted = 0;
  let skipped = 0;
  const errors: { leadId: string; error: string }[] = [];

  for (const lead of eligible ?? []) {
    try {
      // Claim this lead atomically before anything else. Two overlapping
      // runs — a double-click on the button, or a retried request — would
      // otherwise both pass the eligibility filter above and each draft
      // their own separately-worded nudge for the same still-outstanding
      // item, landing as two near-duplicate texts seconds apart. The WHERE
      // clause re-checks eligibility at the DB level: only the run whose
      // UPDATE actually matches a still-eligible row continues: the other
      // has already moved next_reminder_at forward by the time it lands.
      const claimTomorrow = new Date();
      claimTomorrow.setDate(claimTomorrow.getDate() + 1);
      const { data: claimedRows } = await admin
        .from('leads')
        .update({ next_reminder_at: claimTomorrow.toISOString().slice(0, 10) })
        .eq('id', lead.id)
        .or(`next_reminder_at.is.null,next_reminder_at.lte.${todayIso}`)
        .select('id');
      if (!claimedRows || claimedRows.length === 0) {
        skipped++;
        continue;
      }

      const [{ data: inbound }, { data: outbound }] = await Promise.all([
        admin
          .from('inbound_messages')
          .select('body, received_at, has_attachments, to_phone')
          .eq('lead_id', lead.id)
          .eq('is_reaction', false)
          .order('received_at', { ascending: true }),
        admin
          .from('lead_activities')
          .select('body, meta, created_at')
          .eq('lead_id', lead.id)
          .eq('type', 'sms')
          .order('created_at', { ascending: true }),
      ]);

      const hasPhotos = (inbound ?? []).some((m) => m.has_attachments);

      // Partial-Qualified only ever waits on one thing — the photo. If it's
      // arrived since this lead landed here, promote it straight to fully
      // Qualified (followup) instead of drafting a reminder that no longer
      // applies. The qualified-tasks trigger doesn't re-fire here since
      // initial_contact was already a qualified-plus stage.
      if (lead.stage === 'initial_contact' && hasPhotos) {
        await admin.from('leads').update({ stage: 'followup', next_reminder_at: null }).eq('id', lead.id);
        promoted++;
        continue;
      }

      const turns = [
        ...(inbound ?? []).map((m) => ({
          who: 'LEAD' as const,
          body: m.has_attachments ? `${m.body?.trim() ? `${m.body.trim()} ` : ''}[sent photo attachment(s)]` : (m.body ?? ''),
          at: m.received_at,
        })),
        ...(outbound ?? [])
          .filter((a) => (a.meta as any)?.direction === 'outbound')
          .map((a) => ({ who: 'YOU' as const, body: a.body ?? '', at: a.created_at })),
      ].sort((a, b) => a.at.localeCompare(b.at));

      if (turns.length === 0) {
        skipped++;
        continue;
      }

      const transcript = turns.map((t) => `${t.who}: ${t.body}`).join('\n');
      const tagNames: string[] = (lead.lead_tags ?? []).map((lt: any) => lt.tags?.name).filter(Boolean);
      const isLien = tagNames.some((n) => LIEN_TAG_NAMES.includes(n.toLowerCase()));
      const isTax = tagNames.some((n) => TAX_TAG_NAMES.includes(n.toLowerCase()));

      const outstandingHint =
        lead.stage === 'initial_contact'
          ? 'Interior photos of the property — everything else has already been established, this is the only thing left.'
          : `In this priority order: their motivation for selling, property condition, ${isLien ? 'mortgage balance/payment, ' : ''}${
              isTax ? 'back taxes owed, ' : ''
            }asking price, timeline to close, and (last) interior photos. Figure out which of these have NOT actually been answered yet in the conversation below — don't count anything already covered, and there may be more than one still open.`;

      const agentNameRes = await admin.from('profiles').select('full_name').eq('id', lead.user_id).single();
      const agentName = agentNameRes.data?.full_name || 'the Bluebird team';

      const system = `You are texting on behalf of Bluebird Acquisition, a real-estate acquisitions company that buys distressed properties as-is for cash, subject-to, or novation. You are texting as ${agentName}.

TODAY'S DATE is ${todayLabel}.

This lead went quiet mid-conversation. WHAT'S STILL OUTSTANDING: ${outstandingHint}

Read the full conversation below. Two possible outcomes:
1. They've already explicitly promised a specific day they'll respond or send something (e.g. "I'll send it Friday", "I'll get back to you Monday") — extract that as promised_date (an ISO date YYYY-MM-DD, computed from today's date above) and leave reminder_parts empty. Don't draft a message in this case — just reschedule.
2. Otherwise, draft a short, low-pressure, specific check-in — not a generic "just checking in":
   - If only ONE item above is still outstanding: ONE text asking about it.
   - If MORE THAN ONE item is still outstanding: TWO texts, one per item (highest priority first, second-highest next) — never more than 2. The FIRST text is a normal check-in with a brief greeting. The SECOND text is a direct continuation of the same thought as if you're still mid-conversation, not a fresh message — no "hey", no their name, no re-introducing the property, no restating that you're following up. Go straight into the next question the way a real person sends a quick second thought right after the first, e.g. first text "Hey Sarah, just following up, how's the inside of the place looking?" then second text "And what's your timeline looking like to close on this?"
   Text like a real person: short, no "Dear", no em dashes or semicolons, a casual emoji is fine occasionally. Never invent facts or repeat something already answered in the conversation below.

Conversation so far:
${transcript}

Call draft_reminder with your result.`;

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 300,
          system,
          messages: [{ role: 'user', content: 'Draft the reminder (or the reschedule).' }],
          tools: [
            {
              name: 'draft_reminder',
              description: 'The reminder text to send, or a date to silently reschedule to instead.',
              input_schema: {
                type: 'object',
                properties: {
                  reminder_parts: {
                    type: 'array',
                    items: { type: 'string' },
                    maxItems: 2,
                    description:
                      'One message per still-outstanding item, up to 2. A single item gets one message; two outstanding items get two — the second with no greeting, straight into the next question. Empty array if promised_date is set instead.',
                  },
                  promised_date: {
                    type: 'string',
                    description: 'ISO date (YYYY-MM-DD) only if they explicitly promised a specific day. Empty string otherwise.',
                  },
                },
                required: ['reminder_parts', 'promised_date'],
              },
            },
          ],
          tool_choice: { type: 'tool', name: 'draft_reminder' },
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!aiRes.ok) throw new Error(`Anthropic error (${aiRes.status})`);
      const aiData = await aiRes.json();
      const toolUse = (aiData.content ?? []).find((c: any) => c.type === 'tool_use' && c.name === 'draft_reminder');
      if (!toolUse) throw new Error('no draft produced');

      const { reminder_parts: rawParts, promised_date: promisedDateRaw } = toolUse.input as {
        reminder_parts: string[];
        promised_date?: string;
      };

      if (promisedDateRaw?.trim()) {
        const parsed = new Date(promisedDateRaw.trim());
        if (!isNaN(parsed.getTime())) {
          await admin.from('leads').update({ next_reminder_at: parsed.toISOString().slice(0, 10) }).eq('id', lead.id);
          rescheduled++;
          continue;
        }
      }

      const replyParts = (Array.isArray(rawParts) ? rawParts : []).map((p) => humanizePunctuation(String(p).trim())).filter(Boolean);
      if (replyParts.length === 0) {
        skipped++;
        continue;
      }

      const latestInbound = (inbound ?? [])[inbound!.length - 1];
      const toPhoneDigits = (latestInbound?.to_phone ?? '').replace(/[^0-9]/g, '').slice(-10);
      const [, from] =
        Object.entries(NUMBERS).find(([, n]) => n.phone.replace(/[^0-9]/g, '').slice(-10) === toPhoneDigits) ??
        Object.entries(NUMBERS)[0];
      const toPhone = toE164(lead.phone ?? '');
      const phoneNorm = toPhone.replace(/[^0-9]/g, '').slice(-10);

      const token = await zoomToken();
      for (let i = 0; i < replyParts.length; i++) {
        await sendZoomSms(from.phone, toPhone, replyParts[i], token);
        await admin.from('send_log').insert({
          user_id: lead.user_id,
          lead_id: lead.id,
          phone: toPhone,
          phone_norm: phoneNorm,
          sent_from: from.phone,
          body: replyParts[i],
        });
        await admin.from('lead_activities').insert({
          lead_id: lead.id,
          user_id: lead.user_id,
          type: 'sms',
          body: replyParts[i],
          meta: { direction: 'outbound', from: from.phone, to: toPhone, reminder: true },
        });
        if (i < replyParts.length - 1) await new Promise((r) => setTimeout(r, 1200));
      }

      // next_reminder_at is already tomorrow — set by the claim above.
      sent++;
    } catch (e) {
      errors.push({ leadId: lead.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return json({ ok: true, sent, rescheduled, promoted, skipped, errors, totalEligible: (eligible ?? []).length });
});
