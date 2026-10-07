// Edge Function: send-qualify-reminders
//
// Automated escalating-then-steady-state follow-up for leads that go quiet
// mid-qualification (stage 'replied' or 'initial_contact' — "Partial
// Qualified"), anchored on last_inbound_at (stamped by sms-webhook on every
// qualifying reply — see that function's own edit, and migration 0165).
// Independent of send-reminders (the existing manual "Send Reminders"
// button on Kanban, untouched, stays as an admin override) and
// send-onhold-followups (a separate, slower cadence for a different stage).
//
// Schedule (see nextDueAt below): +1h/+3h/+6h the day the lead goes quiet
// (contextual, Claude-drafted, references the specific pending
// qualification question), then a tapering daily cadence through day 9
// (template resend — literally re-sends the lead's original first-contact
// opener by tag, not AI-drafted), then weekly forever. Reminders #1-3 use
// the Claude Haiku drafting approach send-reminders already has (duplicated
// here, not shared — see the "no shared helper" note below); #4+ reuse
// bulk-sms-dispatcher's tag-template-lookup + render() approach instead.
//
// Called only by pg_cron (migration 0166) — no button anywhere triggers
// this. Auth is a purpose-made Vault secret compared against
// x-internal-secret, same pattern as send-onhold-followups/ai-reply-review/
// contract-reminder-sweep — NOT the service-role-key-as-Bearer pattern
// send-reminders still uses (see that function's and 0129's own comments on
// why this project moved away from that pattern).
//
// No shared Zoom-send helper exists anywhere in this codebase —
// send-reminders/send-onhold-followups/send-sms/bulk-sms-dispatcher each
// keep their own independent copy of zoomToken()/sendZoomSms()/toE164()
// (confirmed deliberate house convention — see bulk-sms-dispatcher's own
// header comment). This file duplicates those same helpers verbatim rather
// than importing from an existing function.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const DISPATCH_SECRET = Deno.env.get('QUALIFY_REMINDER_CRON_SECRET')!;

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

// bulk-sms-dispatcher's own merge-tag substitution, verbatim.
function render(template: string, lead: Record<string, unknown>): string {
  return template
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, key: string) => {
      const v = lead[key.toLowerCase()];
      return v == null ? '' : String(v);
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const LIEN_TAG_NAMES = ['lis pendens', 'pre-foreclosure', 'foreclosure', 'auction'];
const TAX_TAG_NAMES = ['tax delinquent'];

// ── Schedule ─────────────────────────────────────────────────────────────

const TIME_ZONE = 'America/New_York';
const HOUR_OFFSETS = [1, 3, 6]; // reminders #1-3, hours after last_inbound_at
// Reminders #4 onward: day offset from last_inbound_at's own calendar date
// (in TIME_ZONE), at a fixed hour. Day 3 is deliberately absent (the gap).
const DAY_SCHEDULE: { day: number; hour: number }[] = [
  { day: 1, hour: 10 }, { day: 1, hour: 15 }, // #4, #5
  { day: 2, hour: 10 }, { day: 2, hour: 15 }, // #6, #7
  { day: 4, hour: 10 }, // #8 (day 3 skipped — the gap)
  { day: 5, hour: 10 }, // #9
  { day: 6, hour: 10 }, // #10
  { day: 7, hour: 10 }, // #11
  { day: 8, hour: 10 }, // #12
  { day: 9, hour: 10 }, // #13
];
const STEADY_STATE_EVERY_DAYS = 7; // #14 = day 16, #15 = day 23, ... forever
const STEADY_STATE_HOUR = 10;
const BUSINESS_HOURS = { start: 8, end: 21 }; // tier-1 clamp, TIME_ZONE

function ymdInZone(utc: Date, timeZone: string): { y: number; m: number; d: number } {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = Object.fromEntries(dtf.formatToParts(utc).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) };
}

function zonedOffsetMinutes(utc: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(utc).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  return (asUTC - utc.getTime()) / 60_000;
}

// The UTC instant for "hour:00:00" on (y, m, d + dayOffset) in timeZone.
function zonedHourOnDate(y: number, m: number, d: number, dayOffset: number, hour: number, timeZone: string): Date {
  // Noon-UTC placeholder avoids a DST-boundary date rollover surprise when
  // just adding whole days — only the resulting calendar date is used next.
  const base = new Date(Date.UTC(y, m - 1, d + dayOffset, 12));
  const { y: ty, m: tm, d: td } = ymdInZone(base, timeZone);
  const guess = new Date(Date.UTC(ty, tm - 1, td, hour, 0, 0));
  const offsetMin = zonedOffsetMinutes(guess, timeZone);
  return new Date(guess.getTime() - offsetMin * 60_000);
}

function clampToBusinessHours(utc: Date, startHour: number, endHour: number, timeZone: string): Date {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', hour: '2-digit' }).format(utc));
  if (hour >= startHour && hour < endHour) return utc;
  const { y, m, d } = ymdInZone(utc, timeZone);
  const dayOffset = hour < startHour ? 0 : 1;
  return zonedHourOnDate(y, m, d, dayOffset, startHour, timeZone);
}

/** sentSoFar = lead.qualify_reminder_stage (reminders already sent this
 *  streak). Returns the due timestamp for reminder #(sentSoFar+1). */
function nextDueAt(sentSoFar: number, lastInboundAt: Date): Date {
  if (sentSoFar < HOUR_OFFSETS.length) {
    const raw = new Date(lastInboundAt.getTime() + HOUR_OFFSETS[sentSoFar] * 3_600_000);
    return clampToBusinessHours(raw, BUSINESS_HOURS.start, BUSINESS_HOURS.end, TIME_ZONE);
  }
  const i = sentSoFar - HOUR_OFFSETS.length;
  const entry =
    i < DAY_SCHEDULE.length
      ? DAY_SCHEDULE[i]
      : { day: DAY_SCHEDULE[DAY_SCHEDULE.length - 1].day + STEADY_STATE_EVERY_DAYS * (i - DAY_SCHEDULE.length + 1), hour: STEADY_STATE_HOUR };
  const { y, m, d } = ymdInZone(lastInboundAt, TIME_ZONE);
  return zonedHourOnDate(y, m, d, entry.day, entry.hour, TIME_ZONE);
}

const isContextualTier = (reminderNumber: number) => reminderNumber <= HOUR_OFFSETS.length;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  if (req.headers.get('x-internal-secret') !== DISPATCH_SECRET) {
    return json({ error: 'Unauthorized.' }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const nowIso = new Date().toISOString();
  const todayLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: TIME_ZONE,
  });

  const { data: eligible, error: leadsErr } = await admin
    .from('leads')
    .select(
      'id, user_id, first_name, last_name, address, city, state, zip, phone, stage, assigned_sms_number, ' +
      'last_inbound_at, qualify_reminder_stage, next_qualify_reminder_at, awaiting_owner_info, scheduled_callback_at, ' +
      'lead_tags(tag_id, tags(name))',
    )
    .in('stage', ['replied', 'initial_contact'])
    .eq('opted_out', false)
    .eq('ai_reply_paused', false)
    // Excludes only an explicit true — a null photo_wait_ai_active (never
    // set) must still count as eligible, not get silently dropped.
    .or('photo_wait_ai_active.eq.false,photo_wait_ai_active.is.null')
    .not('last_inbound_at', 'is', null)
    .not('next_qualify_reminder_at', 'is', null)
    .lte('next_qualify_reminder_at', nowIso)
    .order('next_qualify_reminder_at', { ascending: true })
    .limit(MAX_LEADS_PER_RUN);
  if (leadsErr) return json({ error: leadsErr.message }, 500);

  let sent = 0;
  let rescheduled = 0;
  let skipped = 0;
  let skippedNoTemplate = 0;
  const errors: { leadId: string; error: string }[] = [];

  for (const lead of eligible ?? []) {
    try {
      if (!lead.last_inbound_at) {
        skipped++;
        continue;
      }
      const lastInboundAt = new Date(lead.last_inbound_at);
      const reminderNumber = (lead.qualify_reminder_stage ?? 0) + 1;

      // Claim atomically: push the due timestamp a safe day out, re-checking
      // eligibility in the WHERE — same race-safety trick as
      // send-reminders'/send-onhold-followups' own claims. If the send below
      // fails or nothing ends up being sent, the lead simply retries
      // tomorrow rather than looping every 15 minutes.
      const placeholderNext = new Date(Date.now() + 24 * 3_600_000).toISOString();
      const { data: claimedRows } = await admin
        .from('leads')
        .update({ next_qualify_reminder_at: placeholderNext })
        .eq('id', lead.id)
        .lte('next_qualify_reminder_at', nowIso)
        .select('id');
      if (!claimedRows || claimedRows.length === 0) {
        skipped++;
        continue;
      }

      const tagNames: string[] = (lead.lead_tags ?? []).map((lt: any) => lt.tags?.name).filter(Boolean);

      let replyParts: string[] = [];

      if (isContextualTier(reminderNumber)) {
        // ── Contextual tier: duplicate send-reminders' own outstandingHint +
        // Haiku draft_reminder call. Deliberately excludes its stage-mutating
        // branches (auto-decline on awaiting_owner_info, auto-promote on
        // needsOfferCallback) — those are daily-cadence business rules too
        // aggressive fired hourly; this function only ever writes
        // qualify_reminder_stage/next_qualify_reminder_at plus the SMS
        // itself, never `stage`.
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
        const needsOfferCallback = lead.stage === 'initial_contact' && hasPhotos && !lead.scheduled_callback_at;
        const isLien = tagNames.some((n) => LIEN_TAG_NAMES.includes(n.toLowerCase()));
        const isTax = tagNames.some((n) => TAX_TAG_NAMES.includes(n.toLowerCase()));

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

        const outstandingHint = lead.awaiting_owner_info
          ? "Whether they know who owns the property now, or a way to reach that person — they already said this isn't/wasn't their place, this is the only thing being waited on."
          : needsOfferCallback
            ? 'A specific day and time to call them to go over the offer — they already sent photos, everything else is done, this is the only thing left.'
            : lead.stage === 'initial_contact'
              ? isLien
                ? 'Interior photos of the property, and a copy of their mortgage statement emailed to dayyan@bluebirdacquisition.com — everything else has already been established, these are the only things left.'
                : 'Interior photos of the property — everything else has already been established, this is the only thing left.'
              : `In this priority order: their motivation for selling, property condition, ${isLien ? 'mortgage balance/payment, ' : ''}${
                  isTax ? 'back taxes owed, ' : ''
                }asking price, timeline to close, interior photos${
                  isLien ? ', and (last) their mortgage statement emailed to dayyan@bluebirdacquisition.com' : ' (last)'
                }. Figure out which of these have NOT actually been answered yet in the conversation below — don't count anything already covered, and there may be more than one still open.`;

        const agentNameRes = await admin.from('profiles').select('full_name').eq('id', lead.user_id).single();
        const agentName = agentNameRes.data?.full_name || 'the Bluebird team';

        const system = `You are texting on behalf of Bluebird Acquisition, a real-estate acquisitions company that buys distressed properties as-is for cash, subject-to, or novation. You are texting as ${agentName}.

TODAY'S DATE is ${todayLabel}.

This lead went quiet mid-conversation. This is reminder #${reminderNumber} of an automated sequence — they haven't replied to the earlier one(s) either, so this needs to read like a fresh, differently-worded check-in, not a repeat of the same message. WHAT'S STILL OUTSTANDING: ${outstandingHint}

Read the full conversation below. Two possible outcomes:
1. They've already explicitly promised a specific day they'll respond or send something (e.g. "I'll send it Friday", "I'll get back to you Monday") — extract that as promised_date (an ISO date YYYY-MM-DD, computed from today's date above) and leave reminder_parts empty. Don't draft a message in this case — just reschedule.
2. Otherwise, draft a short, low-pressure, specific check-in — not a generic "just checking in":
   - If only ONE item above is still outstanding: ONE text asking about it.
   - If MORE THAN ONE item is still outstanding: TWO texts, one per item (highest priority first, second-highest next) — never more than 2. The FIRST text is a normal check-in with a brief greeting. The SECOND text is a direct continuation of the same thought as if you're still mid-conversation, not a fresh message — no "hey", no their name, no re-introducing the property, no restating that you're following up.
   Text like a real person: short, no "Dear", no em dashes or semicolons, a casual emoji is fine occasionally. Never invent facts or repeat something already answered in the conversation below. Never reuse a stock opener — vary the whole shape of the message from however you'd normally open, since this is a repeat nudge, not the first one.
   Never state, confirm, or imply that any dollar figure is "the offer," "what we'll pay," or a finalized/agreed price — not even a number the seller stated themselves as their asking price earlier in the conversation. You only nudge for still-outstanding items; a human decides and makes the actual offer, always on a call, never over text.

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
            const { y, m: mo, d } = { y: parsed.getUTCFullYear(), m: parsed.getUTCMonth() + 1, d: parsed.getUTCDate() };
            const rescheduleAt = zonedHourOnDate(y, mo, d, 0, STEADY_STATE_HOUR, TIME_ZONE);
            // Nothing was actually sent — qualify_reminder_stage stays as-is,
            // only the due timestamp moves to the promised date.
            await admin.from('leads').update({ next_qualify_reminder_at: rescheduleAt.toISOString() }).eq('id', lead.id);
            rescheduled++;
            continue;
          }
        }

        replyParts = (Array.isArray(rawParts) ? rawParts : []).map((p) => humanizePunctuation(String(p).trim())).filter(Boolean);
        if (replyParts.length === 0) {
          skipped++;
          continue;
        }
      } else {
        // ── Template tier: duplicate bulk-sms-dispatcher's tag-based
        // template lookup + render(), scoped to one lead. No AI call.
        const tagIds: string[] = (lead.lead_tags ?? []).map((lt: any) => lt.tag_id).filter(Boolean);
        let templateQuery = admin.from('sms_bulk_templates').select('tag_id, body').eq('user_id', lead.user_id);
        templateQuery = tagIds.length > 0
          ? templateQuery.or(`tag_id.in.(${tagIds.join(',')}),tag_id.is.null`)
          : templateQuery.is('tag_id', null);
        const { data: templates } = await templateQuery;
        const byTagId = new Map((templates ?? []).map((t: any) => [t.tag_id, t.body]));
        const template = tagIds.map((id) => byTagId.get(id)).find(Boolean) ?? byTagId.get(null);

        if (!template) {
          skippedNoTemplate++;
          continue;
        }

        const rendered = render(template, {
          first_name: lead.first_name,
          last_name: lead.last_name,
          address: lead.address,
          city: lead.city,
          state: lead.state,
          zip: lead.zip,
        });
        if (!rendered) {
          skippedNoTemplate++;
          continue;
        }
        replyParts = [rendered];
      }

      // Same pinned-number reuse as send-reminders — the reply always lands
      // in the same Zoom thread as everything before it.
      const pinnedKey = lead.assigned_sms_number as string | null | undefined;
      const pinnedNumber = pinnedKey ? NUMBERS[pinnedKey] : undefined;
      let fromKey: string;
      let from: { phone: string; email: string };
      if (pinnedKey && pinnedNumber?.phone && pinnedNumber.email) {
        fromKey = pinnedKey;
        from = pinnedNumber;
      } else {
        [fromKey, from] = Object.entries(NUMBERS)[0];
      }
      if (lead.assigned_sms_number !== fromKey) {
        await admin.from('leads').update({ assigned_sms_number: fromKey }).eq('id', lead.id);
      }
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
          meta: { direction: 'outbound', from: from.phone, to: toPhone, qualifyReminder: true, reminderNumber },
        });
        if (i < replyParts.length - 1) await new Promise((r) => setTimeout(r, 1200));
      }

      await admin
        .from('leads')
        .update({
          qualify_reminder_stage: reminderNumber,
          next_qualify_reminder_at: nextDueAt(reminderNumber, lastInboundAt).toISOString(),
        })
        .eq('id', lead.id);
      sent++;
    } catch (e) {
      errors.push({ leadId: lead.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return json({ ok: true, sent, rescheduled, skipped, skippedNoTemplate, errors, totalEligible: (eligible ?? []).length });
});
