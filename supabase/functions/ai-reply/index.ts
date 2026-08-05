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
  '3': {
    phone: Deno.env.get('ZOOM_FROM_NUMBER_3') ?? '',
    email: Deno.env.get('ZOOM_USER_EMAIL_3') ?? '',
    label: Deno.env.get('ZOOM_LABEL_3') ?? 'Number 3',
  },
  '4': {
    phone: Deno.env.get('ZOOM_FROM_NUMBER_4') ?? '',
    email: Deno.env.get('ZOOM_USER_EMAIL_4') ?? '',
    label: Deno.env.get('ZOOM_LABEL_4') ?? 'Number 4',
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

// The STYLE rules below already forbid these, but a model doesn't always
// comply, and a stray em dash or semicolon reads as robotic rather than a
// real person texting — this is a deterministic safety net on top of the
// prompt instruction, not a replacement for it.
function humanizePunctuation(text: string): string {
  return text.replace(/\s*[—–]\s*/g, ', ').replace(/\s*;\s*/g, ', ');
}

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

WHAT YOU ACTUALLY KNOW ABOUT THIS LEAD — real data from the CRM, not something to recite as a list, only bring it up naturally when it's actually relevant (e.g. confirming which property you mean):
{{LEAD_CONTEXT}}

If a fact isn't given above and wasn't actually said earlier in this conversation, you don't know it. Never write a placeholder, template token, or bracketed stand-in like [ADDRESS], {{address}}, {address}, or [NAME] in place of a real value — that is never acceptable output, treat it exactly like inventing a fact outright. If you don't have something, say you'll check and get back to them, or ask, instead of putting anything in its place.

STYLE — every reply, always:
- Text like a real person, not a business. Short. One thought per message.
- Break the reply into separate messages in reply_parts whenever there's more than one distinct thought, or a side reaction (a laugh, "no worries", "totally get it", "fair point") that a real person would send separately from the substantive point rather than cramming both into one text with a comma or dash. Usually 1-2 messages, 3 only if genuinely needed. This is what real texting looks like, not one long paragraph.
- No "Dear", no signature, no sign-off.
- Never use an em dash, en dash, or semicolon. Use a comma, a period, or a new message in reply_parts instead.
- A casual emoji is fine occasionally, for a human touch, not in every message.
- Never invent facts, numbers, or offers that were not actually said in this conversation. Never state a specific dollar figure that has not actually been negotiated in this conversation.
- Follow the framework's numbered steps in order — never jump ahead to a later step, and never revisit one already answered. The order across steps is fixed; within a step, phrase it naturally and respond to what they actually say.

BEFORE DRAFTING: review the entire conversation below, both sides, everything said so far, and any prior call/note history provided — not just the latest message in isolation. A frustrated or dismissive reply often has a real reason behind it (like an offer discussed on a call), not just a raw refusal; check the call/note history before assuming it's unexplained. Don't re-ask something already answered. Don't contradict something you already said or that's already on record from a call.

SPECIAL CASES — these came from real conversations going wrong, follow them exactly:

- Identity questions ("who are you", "tell me more about yourself", "who am I talking to"): reply with ONLY your name, the company name, and the website — nothing else. No offers, no prices, no next steps.

- Not the owner, but connected (spouse, sibling, someone living in the property who offers to answer questions): don't keep insisting on contacting the owner directly. Treat them as the point of contact and continue the framework. Only near the end, softly and non-blockingly, ask if they could share the owner's number.

- Wrong number or misdirected, with genuinely zero connection to the property or owner (distinct from the above): ask once if they happen to know the owner or a way to reach them.
  - If they say no, close it out immediately with a plain apology — "My bad, sorry for the mix-up, I'll take you off the list." — and stop. Do not ask them to pass along your info or contact you if the owner reaches out. Set negative_reply true.
  - If they say yes, they know who the owner is: ask them to share the owner's number, or offer to pass your number along to the owner and mention you're interested in buying the house. Do not set fully_qualified or negative_reply — this conversation stays open on this same lead, it is not itself a qualified seller and there is nothing further to ask it.

- Can't send photos: don't give up. Push back specifically for photos of the INSIDE of the property, not outside — interior condition is what the offer depends on.

- "Come see it yourself" instead of sending photos: explain the real sequence — no inspection before a signed contract, no contract before an offer, no offer before seeing interior-photo condition. Interior photos are needed now, not the other way around.

- Code Violation leads asking "what violation?": don't jump into ownership questions immediately. Redirect toward the cash-offer pitch first — mention you buy houses in any condition, violations included, for cash — and only move into qualification once they show real interest.

- Their name and/or the property address are missing from WHAT YOU ACTUALLY KNOW above: get them confirmed before anything else, ahead of even step 1 of the framework. Ask naturally, not like an intake form ("Hey, this is {{AGENT_NAME}} — who am I speaking with, and just to confirm, is this about the property at [whatever address they mention, if any]?"). Once they answer, treat it as established fact for the rest of the conversation and move into the framework normally.

- Replies with "help", "please help", "need help", or similar (distinct from the bare compliance HELP keyword, which never reaches you): this is them saying they want to move forward, not a request for customer support. Don't ask "help with what?" — briefly acknowledge and go straight into the framework's next step.

- Negative or declining, or an explicit request to not be contacted again (in any phrasing, not just a bare "STOP" — plain STOP-style keywords are handled separately and never reach you): reply "Sorry to bother you, I won't reach out again." and set negative_reply true. Also set hard_decline:
  - false only if the decline is clearly and specifically about the price or offer amount (e.g. "too low", "not enough", "lowball", "insulting offer") and nothing else — not a refusal to sell at all, just this number. This stops you from texting them further without marking them permanently unreachable, since a different number or a human follow-up might still work.
  - true for every other kind of decline — not interested, wrong time, doesn't want to sell, tired of being contacted, or anything not clearly and only about price. If genuinely unsure which one this is, set hard_decline true: treat it as the permanent, safer option rather than guess.

FRAMEWORK for this lead:
{{FRAMEWORK}}

SUMMARY: whenever you set fully_qualified true, also fill in summary — a short, factual, labeled recap of what was actually established (condition, asking price and their reasoning if given, timeline, motivation if mentioned, mortgage details if this is a lien-adjacent lead, and ownership status). This is what a human reads instead of rereading the whole thread, so be complete but not padded, and never invent or infer anything not actually said. Leave summary as an empty string whenever fully_qualified is false.

Call draft_reply with your response, reply_parts broken into separate messages per the STYLE rules above. fully_qualified is true only once every item the framework marks as required for that has actually been established in this conversation.`;

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
    .select('id, user_id, first_name, last_name, address, city, state, zip, stage, notes, opted_out, ai_reply_paused, lead_tags(tags(id, name))')
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
  const [{ data: inbound }, { data: outboundActivity }, { data: callAndNoteActivity }] = await Promise.all([
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
    // Phone calls carry real negotiation context (an offer, a reason for a
    // no) that never appears in the SMS thread at all — without this, a
    // lead saying "your offer was a lowball" is unexplainable static to the
    // model, since nothing in the text history ever mentioned a number.
    admin
      .from('lead_activities')
      .select('body, meta, created_at, type')
      .eq('lead_id', leadId)
      .in('type', ['call', 'note'])
      .order('created_at', { ascending: true }),
  ]);

  // A lead having sent at least one photo anywhere in the thread — not just
  // the message that triggered this run — gates the Follow-Up stage below,
  // so the AI also needs to see it in the transcript to stop asking for one
  // it already has.
  const hasPhotos = (inbound ?? []).some((m) => m.has_attachments);

  type Turn = { who: 'LEAD' | 'YOU'; body: string; at: string; hasText?: boolean };
  const turns: Turn[] = [
    ...(inbound ?? []).map((m): Turn => ({
      who: 'LEAD',
      body: m.has_attachments ? `${m.body?.trim() ? `${m.body.trim()} ` : ''}[sent photo attachment(s)]` : m.body,
      at: m.received_at,
      hasText: !!m.body?.trim(),
    })),
    ...(outboundActivity ?? [])
      .filter((a) => (a.meta as any)?.direction === 'outbound')
      .map((a): Turn => ({ who: 'YOU', body: a.body ?? '', at: a.created_at })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  if (turns.length === 0) return json({ aborted: true, reason: 'no_transcript' });

  // Photos with no accompanying text don't need a reply — the lead is just
  // sharing pictures, not asking or answering anything. Only skip when every
  // LEAD turn since our last reply is text-free; a real question sitting
  // alongside or after the photos still gets answered.
  const lastYouIdx = turns.map((t) => t.who).lastIndexOf('YOU');
  const unansweredLeadTurns = turns.slice(lastYouIdx + 1).filter((t) => t.who === 'LEAD');
  if (unansweredLeadTurns.length > 0 && unansweredLeadTurns.every((t) => !t.hasText)) {
    return json({ aborted: true, reason: 'image_only_no_reply' });
  }

  const transcript = turns.map((t) => `${t.who}: ${t.body}`).join('\n');

  // Background, not dialogue — kept as a separate block rather than merged
  // into the LEAD/YOU transcript above, so the model never mistakes a call
  // note for something either side actually typed in this text thread.
  const callContext = (callAndNoteActivity ?? [])
    .filter((a) => a.body?.trim())
    .map((a) => {
      const outcome = (a.meta as { outcome?: string })?.outcome;
      const label = a.type === 'call' ? `Call${outcome ? ` (outcome: ${outcome})` : ''}` : 'Note';
      const dateLabel = new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `[${label}, ${dateLabel}] ${a.body!.trim()}`;
    })
    .join('\n');

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

  // The one fix directly behind this block: without it, the model has no
  // real address at all, and when it needs to reference "the property" it
  // has nothing to draw from — which is how it ended up texting the literal
  // string "[ADDRESS]" to a real lead instead of her actual street address.
  const addressLine = [lead.address, [lead.city, lead.state].filter(Boolean).join(', '), lead.zip]
    .filter(Boolean)
    .join(', ');
  const leadContextLines = [
    lead.first_name ? `Their first name: ${lead.first_name}` : null,
    addressLine ? `Property address: ${addressLine}` : null,
  ].filter(Boolean);
  const leadContext =
    leadContextLines.length > 0
      ? leadContextLines.join('\n')
      : 'No address or name on file for this lead in the CRM yet. Before going further into the framework, ask them directly to confirm their name and the property address you\'re texting about, so their file is accurate. Never guess at either.';

  const system = SYSTEM_RULES.replace('{{AGENT_NAME}}', agentName)
    .replace('{{LEAD_CONTEXT}}', leadContext)
    .replace('{{FRAMEWORK}}', framework);

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
          content: `${callContext ? `Prior call/note history for this lead — real background, not part of this text thread, but relevant context for why they might be saying what they're saying:\n${callContext}\n\n` : ''}Conversation so far:\n\n${transcript}\n\nDraft the next reply.`,
        },
      ],
      tools: [
        {
          name: 'draft_reply',
          description: 'The SMS reply to send, and this lead\'s qualification status.',
          input_schema: {
            type: 'object',
            properties: {
              reply_parts: {
                type: 'array',
                items: { type: 'string' },
                minItems: 1,
                maxItems: 3,
                description:
                  'The reply broken into separate short SMS messages, the way a real person actually texts — one thought per message rather than one long paragraph. A side reaction (a laugh, "no worries", "totally get it") goes in its own message, separate from the substantive point. Usually 1-2 messages, 3 only if genuinely needed.',
              },
              fully_qualified: {
                type: 'boolean',
                description: 'True only once every item the framework marks as required has been established.',
              },
              negative_reply: {
                type: 'boolean',
                description:
                  'True if the lead is declining or asking not to be contacted, or this is a confirmed wrong-number dead-end being closed out. Not for a bare STOP-style keyword, which never reaches you.',
              },
              hard_decline: {
                type: 'boolean',
                description:
                  'Only meaningful when negative_reply is true. False only if the decline is clearly and specifically about the price/offer amount and nothing else, not a refusal to sell at all. True for every other kind of decline, including the wrong-number dead-end case, and true whenever unsure.',
              },
              summary: {
                type: 'string',
                description:
                  "Only meaningful when fully_qualified is true — empty string otherwise. A concise, factual, labeled recap (condition, price, timeline, motivation if mentioned, mortgage details if applicable, ownership status) of what the seller actually said, for a human reading it later without rereading the whole thread. Never invent or infer anything not actually said.",
              },
              confirmed_first_name: {
                type: 'string',
                description:
                  'Only fill in when their first name above was missing and they just stated it in this message for the first time. Empty string otherwise — never repeat a name that was already on file.',
              },
              confirmed_address: {
                type: 'string',
                description:
                  'Only fill in when the property address above was missing and they just confirmed or stated it in this message for the first time. Empty string otherwise — never repeat an address that was already on file.',
              },
            },
            required: ['reply_parts', 'fully_qualified', 'negative_reply'],
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

  const {
    reply_parts: rawParts,
    fully_qualified: fullyQualified,
    negative_reply: negativeReply,
    hard_decline: hardDeclineRaw,
    summary,
    confirmed_first_name: confirmedFirstName,
    confirmed_address: confirmedAddress,
  } = toolUse.input as {
    reply_parts: string[];
    fully_qualified: boolean;
    negative_reply: boolean;
    hard_decline?: boolean;
    summary?: string;
    confirmed_first_name?: string;
    confirmed_address?: string;
  };

  // Fills in a name/address the CRM never had — independent of qualification
  // outcome, since a lead can state their name on a message that doesn't
  // otherwise complete the framework.
  const recoveredFields: Record<string, unknown> = {};
  if (confirmedFirstName?.trim() && !lead.first_name) recoveredFields.first_name = confirmedFirstName.trim();
  if (confirmedAddress?.trim() && !lead.address) recoveredFields.address = confirmedAddress.trim();
  if (Object.keys(recoveredFields).length > 0) {
    await admin.from('leads').update(recoveredFields).eq('id', leadId);
  }
  // Anything other than an explicit false defaults to the safer, permanent
  // path — a missing or ambiguous field is not the same as a confident "this
  // is just about price."
  const hardDecline = hardDeclineRaw !== false;

  const replyParts = (Array.isArray(rawParts) ? rawParts : [])
    .map((p) => humanizePunctuation(String(p).trim()))
    .filter(Boolean);

  if (replyParts.length === 0) {
    if (triggerMessageId) {
      await admin.from('inbound_messages').update({ send_error: 'Empty reply_parts in Anthropic response' }).eq('id', triggerMessageId);
    }
    return json({ error: 'no draft produced' }, 502);
  }

  if (triggerMessageId) {
    await admin.from('inbound_messages').update({ drafted_reply: replyParts.join(' / ') }).eq('id', triggerMessageId);
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
    const phoneNorm = toE164Phone.replace(/[^0-9]/g, '').slice(-10);

    // Sent and logged as separate messages, not one combined text — each
    // part becomes its own bubble in the thread, matching how a real person
    // actually sends a run of short texts instead of one long paragraph.
    for (let i = 0; i < replyParts.length; i++) {
      const part = replyParts[i];
      await sendZoomSms(from.phone, toE164Phone, part, token);

      await admin.from('send_log').insert({
        user_id: lead.user_id,
        lead_id: leadId,
        phone: toE164Phone,
        phone_norm: phoneNorm,
        sent_from: from.phone,
        body: part,
      });

      await admin.from('lead_activities').insert({
        lead_id: leadId,
        user_id: lead.user_id,
        type: 'sms',
        body: part,
        meta: { direction: 'outbound', from: from.phone, to: toE164Phone, aiGenerated: true },
      });

      // A short human-feeling gap between parts of the same reply, and
      // enough separation that the carrier won't reorder them on delivery.
      if (i < replyParts.length - 1) await sleep(1500);
    }
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
  // negative_reply is terminal for the AI on this lead either way — it never
  // texts them again regardless of which branch below fires. hard_decline
  // decides how terminal: a genuine refusal (or a confirmed wrong number)
  // marks Dead + opted_out, excluded from all future contact for good. A
  // decline that's specifically about the price, and nothing else, instead
  // goes to On Hold — the AI backs off, but a human can still follow up
  // later with a different number or offer, since this isn't "there is no
  // real lead at that number," it's "not at this price."
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
    if (hardDecline) {
      await admin.from('leads').update({ stage: 'dead_declined', opted_out: true, ai_reply_paused: true }).eq('id', leadId);
    } else {
      await admin.from('leads').update({ stage: 'onhold', ai_reply_paused: true }).eq('id', leadId);
    }
  } else if (fullyQualified) {
    const updates: Record<string, unknown> = { stage: hasPhotos ? 'followup' : 'initial_contact', ai_reply_paused: true };

    // Prepended, never overwritten — whatever a human already wrote in Notes
    // stays intact below this. Photos come from hasPhotos (already verified
    // against real inbound attachments) rather than asking the model to
    // report on something it isn't the source of truth for.
    if (summary && summary.trim()) {
      const dateLabel = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const photosLine = `Photos: ${hasPhotos ? 'Received' : 'Not yet received'}`;
      const block = `AI Qualification Summary — ${dateLabel}\n${summary.trim()}\n${photosLine}\n\n---\n\n`;
      updates.notes = block + (lead.notes ?? '');
    }

    await admin.from('leads').update(updates).eq('id', leadId);
  }

  return json({ ok: true, sent: true, fullyQualified, negativeReply, hardDecline: negativeReply ? hardDecline : undefined });
});
