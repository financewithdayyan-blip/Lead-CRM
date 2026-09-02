// Edge Function: send-onhold-followups
//
// Daily nurture sweep for leads sitting in On Hold — a soft price decline
// (see ai-reply's negative_reply handling), not a hard no. Re-engages on an
// escalating day schedule (see FOLLOWUP_SCHEDULE_DAYS below, driven by
// leads.next_onhold_followup_at — see migration 0127) since a seller's
// situation can change months later even if it hasn't in the first few
// weeks. Structurally a trim of send-reminders: same
// atomic-claim-then-draft-then-send shape, same pinned-number reuse. Called
// only by pg_cron (migration 0129) — no button anywhere triggers this. Auth
// is a purpose-made secret, not send-reminders' service-role-key pattern —
// see the check below.
//
// Every message is drafted fresh by Claude rather than sent from a fixed
// template, on purpose: the same wording landing in a string of leads'
// threads every 5/10/20 days is exactly what would make this read as
// automated. Stops on its own the moment a lead replies — sms-webhook sets
// onhold_reengaged true on any inbound message from an On Hold lead (see
// migration 0130), which this sweep excludes below, and lets ai-reply's
// normal qualification framework take over from there. The lead itself
// stays on the On Hold stage the whole time (0130) — only this sweep's own
// escalating nurture text stops, not the AI conversation.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const DISPATCH_SECRET = Deno.env.get('ONHOLD_FOLLOWUP_CRON_SECRET')!;

const ZOOM_ACCOUNT_ID = Deno.env.get('ZOOM_ACCOUNT_ID')!;
const ZOOM_CLIENT_ID = Deno.env.get('ZOOM_CLIENT_ID')!;
const ZOOM_CLIENT_SECRET = Deno.env.get('ZOOM_CLIENT_SECRET')!;

const NUMBERS: Record<string, { phone: string; email: string }> = {
  '1': { phone: Deno.env.get('ZOOM_FROM_NUMBER') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL') ?? '' },
  '2': { phone: Deno.env.get('ZOOM_FROM_NUMBER_2') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL_2') ?? '' },
  '3': { phone: Deno.env.get('ZOOM_FROM_NUMBER_3') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL_3') ?? '' },
  '4': { phone: Deno.env.get('ZOOM_FROM_NUMBER_4') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL_4') ?? '' },
  '5': { phone: Deno.env.get('ZOOM_FROM_NUMBER_5') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL_5') ?? '' },
  '6': { phone: Deno.env.get('ZOOM_FROM_NUMBER_6') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL_6') ?? '' },
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

const FETCH_TIMEOUT_MS = 15_000;
// Same reasoning as send-reminders' own cap: one Anthropic + one Zoom call
// per lead, stay well inside the platform's execution-time limit. Any
// backlog just gets picked up on the next run since a lead that wasn't
// reached keeps next_onhold_followup_at in the past.
const MAX_LEADS_PER_RUN = 50;

// The escalating schedule, in days since onhold_entered_at. Past the last
// entry, keeps advancing by 30 days indefinitely — "we will not stop"
// until the lead replies and qualifies (confirmed with the user).
const FOLLOWUP_SCHEDULE_DAYS = [5, 10, 20, 30, 45, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360];

function nextFollowupDay(currentDay: number): number {
  return FOLLOWUP_SCHEDULE_DAYS.find((d) => d > currentDay) ?? currentDay + 30;
}

function addDaysIso(fromIso: string, days: number): string {
  const d = new Date(fromIso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Called only by pg_cron via pg_net, never by a user — a purpose-made
  // Vault secret compared via a plain header, same pattern as
  // bulk-sms-dispatcher and ai-reply-review. NOT the service role key: that
  // key has rotated formats between what's stored in Vault and what
  // deployed edge functions actually see, which silently 401s a job forever
  // with no way to notice (see migration 0077's comment, and 0129 which
  // moved this function onto the same fix after exactly that happened here).
  if (req.headers.get('x-internal-secret') !== DISPATCH_SECRET) {
    return json({ error: 'Unauthorized.' }, 401);
  }

  const todayIso = new Date().toISOString().slice(0, 10);

  const { data: eligible, error: leadsErr } = await admin
    .from('leads')
    .select('id, user_id, first_name, address, city, state, phone, assigned_sms_number, onhold_entered_at, onhold_followup_day')
    .eq('stage', 'onhold')
    .eq('opted_out', false)
    // On Hold leads now stay on this stage through their entire AI
    // conversation (migration 0130) rather than moving to Replied once they
    // reply, so 'stage = onhold' alone no longer means "still silently
    // waiting." onhold_reengaged (set by sms-webhook the moment a reply
    // actually comes in) is what distinguishes that — a lead who's already
    // replied doesn't need another automated "checking in" text landing on
    // top of a live or already-handled conversation.
    .eq('onhold_reengaged', false)
    .or(`next_onhold_followup_at.is.null,next_onhold_followup_at.lte.${todayIso}`)
    .limit(MAX_LEADS_PER_RUN);
  if (leadsErr) return json({ error: leadsErr.message }, 500);

  let sent = 0;
  let skipped = 0;
  const errors: { leadId: string; error: string }[] = [];

  for (const lead of eligible ?? []) {
    try {
      // onhold_entered_at/onhold_followup_day should always be set by the
      // trigger for any lead actually in 'onhold' — skip defensively rather
      // than crash if a row somehow lacks them (e.g. set by a path that
      // predates migration 0127 and hasn't had a stage change since).
      if (!lead.onhold_entered_at || lead.onhold_followup_day == null) {
        skipped++;
        continue;
      }

      // Claim atomically: compute the real next schedule state up front and
      // write it as the claim itself (re-checking eligibility in the WHERE
      // clause), same reasoning as send-reminders' claim — two overlapping
      // runs must not both draft and send for the same lead. If the send
      // itself fails after this, the lead simply waits for its next due
      // date rather than retrying immediately, same trade-off send-reminders
      // already accepts.
      const nextDay = nextFollowupDay(lead.onhold_followup_day);
      const nextDate = addDaysIso(lead.onhold_entered_at, nextDay);
      const { data: claimedRows } = await admin
        .from('leads')
        .update({ onhold_followup_day: nextDay, next_onhold_followup_at: nextDate })
        .eq('id', lead.id)
        .eq('stage', 'onhold')
        .or(`next_onhold_followup_at.is.null,next_onhold_followup_at.lte.${todayIso}`)
        .select('id');
      if (!claimedRows || claimedRows.length === 0) {
        skipped++;
        continue;
      }

      const agentNameRes = await admin.from('profiles').select('full_name').eq('id', lead.user_id).single();
      const agentName = agentNameRes.data?.full_name || 'the Bluebird team';
      const propertyRef = [lead.address, [lead.city, lead.state].filter(Boolean).join(', ')].filter(Boolean).join(', ');
      const daysOnHold = lead.onhold_followup_day;

      const system = `You are texting on behalf of Bluebird Acquisition, a real-estate acquisitions company that buys distressed properties as-is for cash, subject-to, or novation. You are texting as ${agentName}.

This lead is in On Hold: they previously said the price/offer wasn't right for them, not that they weren't interested at all. It's now been about ${daysOnHold} days since that conversation. The property is at ${propertyRef || 'the property you discussed'}.

Write ONE short text re-opening the conversation: check in on whether anything's changed for them (their situation, the property, their thinking on price), and let them know you'd still love the chance to make them an offer. Do not mention a specific dollar figure or imply any number is final — a human only makes a real offer on a call, never over text.

This is being sent as part of an automated long-term follow-up sequence — the SAME lead will get another one of these texts later if they don't respond, worded completely differently next time. Because of that:
- Never reuse a stock opener. Do not always start with "Hey" + their name — vary the whole shape of the message each time (a question first, a quick update first, a soft "circling back" style, etc.).
- Write like a real person sending a quick text, not a company. Short, casual, no "Dear", no em dashes or semicolons, a casual emoji is fine occasionally but not required.
- Reference the property naturally, not with a rigid "we talked about your property at X" template phrase every time.
- Don't literally state the day count ("it's been 47 days") — if it's been a long time, a natural human phrase like "it's been a while" is fine, but only if it doesn't feel forced.
- Never invent facts about the property or the prior conversation beyond what's given above.

Call draft_followup with your result.`;

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 200,
          system,
          messages: [{ role: 'user', content: `Draft this lead's day-${daysOnHold} On Hold follow-up text.` }],
          tools: [
            {
              name: 'draft_followup',
              description: 'The follow-up text to send this lead.',
              input_schema: {
                type: 'object',
                properties: {
                  message: { type: 'string', description: 'The text message to send, worded freshly and differently from a generic template.' },
                },
                required: ['message'],
              },
            },
          ],
          tool_choice: { type: 'tool', name: 'draft_followup' },
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!aiRes.ok) throw new Error(`Anthropic error (${aiRes.status})`);
      const aiData = await aiRes.json();
      const toolUse = (aiData.content ?? []).find((c: any) => c.type === 'tool_use' && c.name === 'draft_followup');
      if (!toolUse) throw new Error('no draft produced');

      const message = humanizePunctuation(String((toolUse.input as { message?: string }).message ?? '').trim());
      if (!message) {
        skipped++;
        continue;
      }

      // Same pinned-number rule send-sms/send-reminders use: reuse whichever
      // number this lead is already pinned to so this always lands in the
      // same Zoom thread as everything before it. Every On Hold lead has
      // prior contact (it's how they got here), so this should always be
      // set — slot 1 is only a last-resort fallback.
      const pinnedKey = (lead.assigned_sms_number as string | null | undefined) || '1';
      const from = NUMBERS[pinnedKey]?.phone ? NUMBERS[pinnedKey] : NUMBERS['1'];
      const toPhone = toE164(lead.phone ?? '');
      const phoneNorm = toPhone.replace(/[^0-9]/g, '').slice(-10);

      const token = await zoomToken();
      await sendZoomSms(from.phone, toPhone, message, token);
      await admin.from('send_log').insert({
        user_id: lead.user_id,
        lead_id: lead.id,
        phone: toPhone,
        phone_norm: phoneNorm,
        sent_from: from.phone,
        body: message,
      });
      await admin.from('lead_activities').insert({
        lead_id: lead.id,
        user_id: lead.user_id,
        type: 'sms',
        body: message,
        meta: { direction: 'outbound', from: from.phone, to: toPhone, onholdFollowup: true, onholdDay: daysOnHold },
      });

      sent++;
    } catch (e) {
      errors.push({ leadId: lead.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return json({ ok: true, sent, skipped, errors, totalEligible: (eligible ?? []).length });
});
