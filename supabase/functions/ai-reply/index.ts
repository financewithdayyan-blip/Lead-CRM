// Edge Function: ai-reply
//
// Drafts and sends the AI auto-reply for one lead. Never called by a user or
// by Zoom directly — sms-webhook triggers it after storing a real (non-
// reaction, non-deterministic-opt-out) inbound message, as a separate,
// independent invocation that this function's own debounce logic assumes.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;

const ZOOM_ACCOUNT_ID = Deno.env.get('ZOOM_ACCOUNT_ID')!;
const ZOOM_CLIENT_ID = Deno.env.get('ZOOM_CLIENT_ID')!;
const ZOOM_CLIENT_SECRET = Deno.env.get('ZOOM_CLIENT_SECRET')!;

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

// Only sms-webhook should ever call this. There is no end user auth on an
// inter-function call, so a shared secret (the service role key, known only
// server-side) stands in for one — cheap insurance against a stray request
// burning Anthropic and Zoom spend.
function isAuthorizedCaller(req: Request): boolean {
  return req.headers.get('x-internal-secret') === SERVICE_ROLE_KEY;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Zoom send (mirrors send-sms's own copy — see the note there on why each
// function keeps its own rather than sharing a module) ─────────────────────

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
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000 };
  return cachedToken.token;
}

async function sendZoomSms(fromPhone: string, toPhone: string, message: string, token: string) {
  const res = await fetch('https://api.zoom.us/v2/phone/sms/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender: { phone_number: fromPhone }, to_members: [{ phone_number: toPhone }], message }),
  });
  if (!res.ok) throw new Error(`Zoom send failed (${res.status}): ${await res.text()}`);
}

function toE164(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return raw.startsWith('+') ? raw : `+${digits}`;
}

// ── Framework resolution ────────────────────────────────────────────────────

// Kept byte-identical to the same constant in src/hooks/useAiReplyConfig.ts —
// that copy is what an admin sees as the Settings placeholder for an unsaved
// Default framework, so it has to say exactly what actually runs here or the
// placeholder becomes misleading about the real fallback behaviour.
const DEFAULT_FRAMEWORK = `Goal: qualify this lead through a natural conversation, but follow the steps below in a fixed order. Do not jump ahead to price or timeline before condition is covered, and don't backtrack to something already answered. Going out of order is exactly how a lead ends up replying with a bare number like "500k" with no context behind it — stay on the current step until it is actually answered before moving to the next.

Steps, in this exact order:
1. Confirm you're speaking with the owner, or someone who can speak for them (see the standing rules on non-owners and wrong numbers).
2. CONDITION — cover these one at a time, in order:
   - How the property looks on the inside, general condition.
   - What they'd rate it, out of 10.
   - Any major repairs needed — HVAC, electrical, plumbing, etc.
   - How old the roof is.
3. PRICE — ask if they have a number in mind. If they give one, ask how they landed on it.
4. TIMELINE — ask if there's a timeline they're looking to close within.
5. PHOTOS — last: ask for interior photos so the current condition can actually be seen.

A lead is FULLY QUALIFIED — which pauses auto-reply and hands off to a human — once CONDITION, PRICE, and TIMELINE above have all actually been established in this conversation. Asking for photos is still a required step before the interview counts as complete, but don't hold fully_qualified back waiting on the photo itself to arrive — once you've asked for it, that step is done; a human takes it from there.`;

const LIEN_ADDENDUM = `

This lead is in foreclosure, lis pendens, or auction proceedings. Insert a MORTGAGE step immediately after CONDITION and before PRICE: ask their monthly payment, total remaining balance owed, and interest rate. Do not ask how far behind they are on payments. This mortgage step is also required for fully_qualified on this tag, alongside condition, price and timeline.

If they mention "a plan": ask whether it involves an attorney postponing the auction. If so, explain that a postponement only delays the auction — it doesn't resolve the underlying situation.`;

const LIEN_TAG_NAMES = ['lis pendens', 'pre-foreclosure', 'foreclosure', 'auction'];

// ── Deterministic style + special-case rules (Phase 3 spec, verbatim) ──────

const SYSTEM_RULES = `You are texting on behalf of Bluebird Acquisition, a real-estate acquisitions company that buys distressed properties as-is for cash, subject-to, or novation. You are texting as {{AGENT_NAME}}.

STYLE — every reply, always:
- 1-3 short sentences. Sound like a real person texting, not a business.
- No "Dear", no signature, no sign-off.
- Never use an em dash. Use a comma or a new sentence instead.
- A casual emoji is fine occasionally, not in every message.
- Never invent facts, numbers, or offers that were not actually said in this conversation. Never state a specific dollar figure that has not actually been negotiated in this conversation.
- Follow the framework's numbered steps in order — never jump ahead to a later step, and never revisit one already answered. The order across steps is fixed; within a step, phrase it naturally and respond to what they actually say.

BEFORE DRAFTING: review the entire conversation below, both sides, everything said so far — not just the latest message in isolation. Don't re-ask something already answered. Don't contradict something you already said.

SPECIAL CASES — these came from real conversations going wrong, follow them exactly:

- Identity questions ("who are you", "tell me more about yourself", "who am I talking to"): reply with ONLY your name, the company name, and the website — nothing else. No offers, no prices, no next steps.

- Not the owner, but connected (spouse, sibling, someone living in the property who offers to answer questions): don't keep insisting on contacting the owner directly. Treat them as the point of contact and continue the framework. Only near the end, softly and non-blockingly, ask if they could share the owner's number.

- Wrong number or misdirected, with genuinely zero connection to the property or owner (distinct from the above): ask once if they happen to know the owner or a way to reach them.
  - If they say no, close it out immediately with a plain apology — "My bad, sorry for the mix-up, I'll take you off the list." — and stop. Do not ask them to pass along your info or contact you if the owner reaches out. Set negative_reply true.
  - If they say yes, they know who the owner is: ask them to share the owner's number, or offer to pass your number along to the owner and mention you're interested in buying the house. Do not set fully_qualified or negative_reply — this conversation stays open on this same lead, it is not itself a qualified seller and there is nothing further to ask it.

- Can't send photos: don't give up. Push back specifically for photos of the INSIDE of the property, not outside — interior condition is what the offer depends on.

- "Come see it yourself" instead of sending photos: explain the real sequence — no inspection before a signed contract, no contract before an offer, no offer before seeing interior-photo condition. Interior photos are needed now, not the other way around.

- Code Violation leads asking "what violation?": don't jump into ownership questions immediately. Redirect toward the cash-offer pitch first — mention you buy houses in any condition, violations included, for cash — and only move into qualification once they show real interest.

- Negative or declining, or an explicit request to not be contacted again (in any phrasing, not just a bare "STOP" — plain STOP-style keywords are handled separately and never reach you): reply "Sorry to bother you, I won't reach out again." and set negative_reply true.

FRAMEWORK for this lead:
{{FRAMEWORK}}

Call draft_reply with your response. fully_qualified is true only once every item the framework marks as required for that has actually been established in this conversation.`;

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (!isAuthorizedCaller(req)) return json({ error: 'unauthorized' }, 401);

  let leadId: string, triggerReceivedAt: string, triggerMessageId: string;
  try {
    const body = await req.json();
    leadId = body.leadId;
    triggerReceivedAt = body.triggerReceivedAt;
    triggerMessageId = body.triggerMessageId;
    if (!leadId || !triggerReceivedAt) throw new Error('missing leadId/triggerReceivedAt');
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'bad request' }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Step 1: wait before drafting anything, so a burst of fragment messages
  // has time to finish arriving before any of them gets answered.
  await sleep(16_000);

  // Step 2: if a newer message has arrived for this lead since the one that
  // triggered this invocation, abort entirely. That newer message's own
  // invocation (woken by its own webhook call) will handle the reply once
  // its wait elapses — this is what makes only the LAST message in a burst
  // actually send, with no shared state between invocations.
  const { count: newerCount } = await admin
    .from('inbound_messages')
    .select('id', { count: 'exact', head: true })
    .eq('lead_id', leadId)
    .gt('received_at', triggerReceivedAt);
  if ((newerCount ?? 0) > 0) {
    return json({ aborted: true, reason: 'superseded_by_newer_message' });
  }

  // Step 3: gates that stop auto-reply entirely, checked fresh (not cached
  // from whenever the webhook fired) since 16s+ has passed and a human may
  // have taken over in the meantime.
  const { data: lead } = await admin
    .from('leads')
    .select('id, user_id, first_name, last_name, stage, opted_out, ai_reply_paused, lead_tags(tags(id, name))')
    .eq('id', leadId)
    .single();

  if (!lead) return json({ aborted: true, reason: 'lead_not_found' });
  if (lead.opted_out) return json({ aborted: true, reason: 'opted_out' });
  if (lead.ai_reply_paused) return json({ aborted: true, reason: 'ai_reply_paused' });

  // A lead can leave the AI-active part of the pipeline without
  // ai_reply_paused ever being set — a manual drag on the Kanban board, or a
  // deal actually handled by phone/Zoom-app and only reflected here after the
  // fact. The AI must never text a lead sitting in Qualified, Follow-Up,
  // Negotiation or any later stage regardless of how it got there, so this is
  // a second, independent gate rather than trusting ai_reply_paused alone.
  const AI_ACTIVE_STAGES = new Set(['contacted', 'replied']);
  if (!AI_ACTIVE_STAGES.has(lead.stage)) {
    return json({ aborted: true, reason: 'stage_not_ai_active', stage: lead.stage });
  }

  const { data: settings } = await admin
    .from('ai_settings')
    .select('auto_reply_enabled')
    .eq('user_id', lead.user_id)
    .maybeSingle();
  // No row yet means the account has never touched the toggle — defaults on.
  if (settings && settings.auto_reply_enabled === false) {
    return json({ aborted: true, reason: 'auto_reply_globally_disabled' });
  }

  // Step 4: build the transcript, both directions, chronological.
  const [{ data: inbound }, { data: outboundActivity }] = await Promise.all([
    admin
      .from('inbound_messages')
      .select('body, received_at, has_attachments')
      .eq('lead_id', leadId)
      .eq('is_reaction', false)
      .order('received_at', { ascending: true }),
    admin
      .from('lead_activities')
      .select('body, meta, created_at')
      .eq('lead_id', leadId)
      .eq('type', 'sms')
      .order('created_at', { ascending: true }),
  ]);

  // A lead having sent at least one photo anywhere in the thread — not just
  // the message that triggered this run — gates the Follow-Up stage below,
  // so the AI also needs to see it in the transcript to stop asking for one
  // it already has.
  const hasPhotos = (inbound ?? []).some((m) => m.has_attachments);

  type Turn = { who: 'LEAD' | 'YOU'; body: string; at: string };
  const turns: Turn[] = [
    ...(inbound ?? []).map((m): Turn => ({
      who: 'LEAD',
      body: m.has_attachments ? `${m.body?.trim() ? `${m.body.trim()} ` : ''}[sent photo attachment(s)]` : m.body,
      at: m.received_at,
    })),
    ...(outboundActivity ?? [])
      .filter((a) => (a.meta as any)?.direction === 'outbound')
      .map((a): Turn => ({ who: 'YOU', body: a.body ?? '', at: a.created_at })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  if (turns.length === 0) return json({ aborted: true, reason: 'no_transcript' });

  const transcript = turns.map((t) => `${t.who}: ${t.body}`).join('\n');

  // Step 5: resolve the framework — first tag carrying its own saved text,
  // else Default, else the hardcoded fallback if nothing has been saved at
  // all yet. Lien-adjacent tags always layer the mortgage addendum on top,
  // regardless of whether that tag has a custom framework, so customizing a
  // tag's text can't accidentally drop the mortgage question.
  const tagNames: string[] = (lead.lead_tags ?? []).map((lt: any) => lt.tags?.name).filter(Boolean);
  const tagIds: string[] = (lead.lead_tags ?? []).map((lt: any) => lt.tags?.id).filter(Boolean);

  const { data: configs } = await admin
    .from('ai_reply_config')
    .select('tag_id, framework')
    .eq('user_id', lead.user_id)
    .or(`tag_id.is.null,tag_id.in.(${tagIds.length ? tagIds.join(',') : '00000000-0000-0000-0000-000000000000'})`);

  const tagFramework = (configs ?? []).find((c) => c.tag_id !== null && c.framework?.trim());
  const defaultFramework = (configs ?? []).find((c) => c.tag_id === null && c.framework?.trim())?.framework;
  let framework = tagFramework?.framework || defaultFramework || DEFAULT_FRAMEWORK;

  const isLienLead = tagNames.some((n) => LIEN_TAG_NAMES.includes(n.toLowerCase()));
  if (isLienLead) framework += LIEN_ADDENDUM;

  const { data: ownerProfile } = await admin.from('profiles').select('full_name').eq('id', lead.user_id).single();
  const agentName = ownerProfile?.full_name || 'the Bluebird team';

  const system = SYSTEM_RULES.replace('{{AGENT_NAME}}', agentName).replace('{{FRAMEWORK}}', framework);

  // Step 6: draft, via forced tool-call output so the three fields are
  // structured rather than parsed out of prose.
  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 500,
      system,
      messages: [
        {
          role: 'user',
          content: `Conversation so far:\n\n${transcript}\n\nDraft the next reply.`,
        },
      ],
      tools: [
        {
          name: 'draft_reply',
          description: 'The SMS reply to send, and this lead\'s qualification status.',
          input_schema: {
            type: 'object',
            properties: {
              reply: { type: 'string', description: 'The exact text message to send to the lead.' },
              fully_qualified: {
                type: 'boolean',
                description: 'True only once every item the framework marks as required has been established.',
              },
              negative_reply: {
                type: 'boolean',
                description:
                  'True if the lead is declining or asking not to be contacted, or this is a confirmed wrong-number dead-end being closed out. Not for a bare STOP-style keyword, which never reaches you.',
              },
            },
            required: ['reply', 'fully_qualified', 'negative_reply'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'draft_reply' },
    }),
  });

  if (!aiRes.ok) {
    const errText = await aiRes.text();
    if (triggerMessageId) {
      await admin.from('inbound_messages').update({ send_error: `Anthropic error: ${errText.slice(0, 500)}` }).eq('id', triggerMessageId);
    }
    return json({ error: `Anthropic error (${aiRes.status})` }, 502);
  }

  const aiData = await aiRes.json();
  const toolUse = (aiData.content ?? []).find((c: any) => c.type === 'tool_use' && c.name === 'draft_reply');
  if (!toolUse) {
    if (triggerMessageId) {
      await admin.from('inbound_messages').update({ send_error: 'No tool_use in Anthropic response' }).eq('id', triggerMessageId);
    }
    return json({ error: 'no draft produced' }, 502);
  }

  const { reply, fully_qualified: fullyQualified, negative_reply: negativeReply } = toolUse.input as {
    reply: string;
    fully_qualified: boolean;
    negative_reply: boolean;
  };

  if (triggerMessageId) {
    await admin.from('inbound_messages').update({ drafted_reply: reply }).eq('id', triggerMessageId);
  }

  // Step 7: reply from whichever of our numbers this conversation is
  // actually happening on, not a hardcoded default.
  const { data: latestInbound } = await admin
    .from('inbound_messages')
    .select('to_phone')
    .eq('lead_id', leadId)
    .order('received_at', { ascending: false })
    .limit(1)
    .single();
  const toPhoneDigits = (latestInbound?.to_phone ?? '').replace(/[^0-9]/g, '').slice(-10);
  const [, from] =
    Object.entries(NUMBERS).find(([, n]) => n.phone.replace(/[^0-9]/g, '').slice(-10) === toPhoneDigits) ??
    Object.entries(NUMBERS)[0];

  const leadPhoneRow = await admin.from('leads').select('phone').eq('id', leadId).single();
  const toE164Phone = toE164(leadPhoneRow.data?.phone ?? '');

  try {
    const token = await zoomToken();
    await sendZoomSms(from.phone, toE164Phone, reply, token);

    await admin.from('send_log').insert({
      user_id: lead.user_id,
      lead_id: leadId,
      phone: toE164Phone,
      phone_norm: toE164Phone.replace(/[^0-9]/g, '').slice(-10),
      sent_from: from.phone,
      body: reply,
    });

    await admin.from('lead_activities').insert({
      lead_id: leadId,
      user_id: lead.user_id,
      type: 'sms',
      body: reply,
      meta: { direction: 'outbound', from: from.phone, to: toE164Phone, aiGenerated: true },
    });
  } catch (e) {
    if (triggerMessageId) {
      await admin
        .from('inbound_messages')
        .update({ send_error: e instanceof Error ? e.message : String(e) })
        .eq('id', triggerMessageId);
    }
    return json({ error: 'send failed', detail: e instanceof Error ? e.message : String(e) }, 502);
  }

  // Step 8: route the pipeline and pause auto-reply where the outcome calls
  // for a human.
  //
  // negative_reply is terminal for the AI on this lead — see the spec's own
  // framing that a decline and a confirmed wrong number are "the same: end
  // the conversation, mark Dead, exclude from future bulk sends" — there is
  // no real lead at that number either way.
  //
  // fully_qualified always pauses the AI immediately — its only job is to
  // qualify, and once the framework interview (condition/price/timeline,
  // +mortgage for lien leads, photos asked as the last step) is done, a
  // human takes over. Whether that human already has a photo in hand decides
  // Qualified vs. Follow-Up, but doesn't change that the AI stops.
  //
  // Anything else (still mid-framework) makes no stage change at all — the
  // lead just stays in Replied for the whole back-and-forth. It only ever
  // leaves Replied once qualified, matching AI_ACTIVE_STAGES above.
  if (negativeReply) {
    await admin.from('leads').update({ stage: 'dead_declined', opted_out: true, ai_reply_paused: true }).eq('id', leadId);
  } else if (fullyQualified) {
    await admin
      .from('leads')
      .update({ stage: hasPhotos ? 'followup' : 'initial_contact', ai_reply_paused: true })
      .eq('id', leadId);
  }

  return json({ ok: true, sent: true, fullyQualified, negativeReply });
});
