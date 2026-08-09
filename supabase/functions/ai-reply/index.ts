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
  '5': {
    phone: Deno.env.get('ZOOM_FROM_NUMBER_5') ?? '',
    email: Deno.env.get('ZOOM_USER_EMAIL_5') ?? '',
    label: Deno.env.get('ZOOM_LABEL_5') ?? 'Number 5',
  },
  '6': {
    phone: Deno.env.get('ZOOM_FROM_NUMBER_6') ?? '',
    email: Deno.env.get('ZOOM_USER_EMAIL_6') ?? '',
    label: Deno.env.get('ZOOM_LABEL_6') ?? 'Number 6',
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

// A hung Zoom or Anthropic call with no timeout stalls this invocation
// forever with nothing to ever surface the failure — the lead just never
// gets a reply and nothing shows up as an error anywhere. Same class of bug
// found and fixed in send-sms (see the note there): two bulk jobs got stuck
// at 'running' forever because their own Zoom fetches had no timeout either.
const FETCH_TIMEOUT_MS = 15_000;

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
2. MOTIVATION — ask why they're looking to sell, or what's going on with the property. A brief, natural answer is enough — don't push for more than they volunteer, and don't turn it into an interrogation.
3. CONDITION — cover these one at a time, in order:
   - How the property looks on the inside, general condition.
   - What they'd rate it, out of 10.
   - Any major repairs needed — HVAC, electrical, plumbing, etc.
   - How old the roof is.
4. PRICE — ask if they have a number in mind. If they give one, ask how they landed on it.
5. TIMELINE — ask if there's a timeline they're looking to close within.
6. PHOTOS — ask for interior photos so the current condition can actually be seen.
7. CALLBACK — last: ask what's a good time to call them back tomorrow to go over everything. This step isn't done just by asking — wait for them to actually give you a real day and time before it counts as answered.

A lead is FULLY QUALIFIED — which pauses auto-reply and hands off to a human — once MOTIVATION, CONDITION, PRICE, and TIMELINE above have all actually been established in this conversation. Asking for photos is still a required step before the interview counts as complete, but don't hold fully_qualified back waiting on the photo itself to arrive — once you've asked for it, that step is done; a human takes it from there. The CALLBACK step is different: it is only done once they've actually given a specific day and time to call back, not just once you've asked — fully_qualified must wait for that real answer.`;

const LIEN_ADDENDUM = `

This lead is in foreclosure, lis pendens, or auction proceedings. Insert a MORTGAGE step immediately after CONDITION and before PRICE: ask their monthly payment, total remaining balance owed, and interest rate. Do not ask how far behind they are on payments. This mortgage step is also required for fully_qualified on this tag, alongside motivation, condition, price and timeline.

If they mention "a plan": ask whether it involves an attorney postponing the auction. If so, explain that a postponement only delays the auction — it doesn't resolve the underlying situation.`;

const LIEN_TAG_NAMES = ['lis pendens', 'pre-foreclosure', 'foreclosure', 'auction'];

const TAX_ADDENDUM = `

This lead is tax delinquent. Insert a TAXES step immediately after CONDITION and before PRICE: ask how much they owe in back taxes, and how many years behind they are. Do not ask about a mortgage unless they bring it up themselves. This taxes step is also required for fully_qualified on this tag, alongside motivation, condition, price and timeline.`;

const TAX_TAG_NAMES = ['tax delinquent'];

// Appended to every framework, tag-specific or Default — a saved custom tag
// framework has no way to know about this on its own, so it can't be left up
// to whatever framework text happens to be active. Kept intentionally
// separate from DEFAULT_FRAMEWORK's own CALLBACK step above (which a custom
// tag framework overrides entirely) so the requirement survives regardless.
const CALLBACK_ADDENDUM = `

CALLBACK STEP — required for every lead regardless of anything else above: after motivation, condition, price, timeline (and mortgage, if this is a lien-adjacent lead) are established and you've asked for interior photos, ask one more thing before the interview counts as complete: what's a good time to call them back tomorrow. This is not done just by asking — wait for them to actually name a real day and time. Only once they do can fully_qualified be true (assuming everything else required is also already established). When they give you a time, fill in scheduled_callback_at and scheduled_callback_note on the same turn.`;

// ── Photo-wait mode — a lead sitting in Partial Qualified (initial_contact).
// Everything the regular framework asks for is already answered; the only
// open item is interior photos, so this replaces the framework prompt
// entirely rather than layering onto it, and the tool below drops every
// qualification-specific field (fully_qualified, summary, next_action, ...)
// that no longer applies. ─────────────────────────────────────────────────
const PHOTO_WAIT_SYSTEM = `You are texting on behalf of Bluebird Acquisition, a real-estate acquisitions company that buys distressed properties as-is for cash, subject-to, or novation. You are texting as {{AGENT_NAME}}.

TODAY'S DATE is {{TODAY}} — the only basis you have for turning something like "tomorrow" or "Thursday afternoon" into an actual date.

WHAT YOU ACTUALLY KNOW ABOUT THIS LEAD:
{{LEAD_CONTEXT}}

This lead already answered every qualification question — motivation, condition, price, timeline, and mortgage or back taxes if applicable. Two things are still outstanding, in order: interior photos of the property, then a specific day and time to call them and go over the offer. Never ask about motivation, condition, price, timeline, mortgage, or taxes again — all of that is already settled, and re-asking will only confuse them.

Read their message and the conversation so far, then reply naturally, the way a real person texts:
- If photos haven't come in yet (not in this message, not earlier in the conversation): respond naturally to whatever they actually said — a delay, a question, chit-chat. Don't ask for a callback time yet, that comes after photos.
- Once photos are in (this message or already in the conversation) and they have NOT yet given a real day/time to call about the offer: if this message is what just delivered the photos, thank them briefly, then ask what's a good time to call them to go over the offer. If photos already came in earlier and you haven't asked yet, ask now. If you already asked and they're just chatting, respond naturally and don't re-ask.
- Once they actually give a specific day and time to call about the offer: fill in scheduled_callback_at and scheduled_callback_note — an ISO 8601 date-time (YYYY-MM-DDTHH:MM:SS, no timezone) computed from TODAY'S DATE above. If they gave a day but no specific time (or vice versa), use your best reasonable estimate (e.g. "tomorrow morning" -> 09:00:00) rather than leaving it blank. This is not done just by asking — only fill these in once they've actually given a real answer.
- If they're declining or asking not to be contacted again, in any phrasing: reply "Sorry to bother you, I won't reach out again." and set negative_reply true. Set hard_decline false only if the decline is clearly and specifically about the price/offer amount and nothing else; true for every other kind of decline, including if unsure.

STYLE:
- Text like a real person, not a business. Short. One thought per message.
- Break the reply into separate messages in reply_parts whenever there's more than one distinct thought.
- No "Dear", no signature, no sign-off.
- Never use an em dash, en dash, or semicolon. Use a comma, a period, or a new message in reply_parts instead.
- A casual emoji is fine occasionally, not in every message.
- Never invent facts, numbers, or offers not actually said in this conversation.

Call draft_photo_wait_reply with your response.`;

// ── Deterministic style + special-case rules (Phase 3 spec, verbatim) ──────

const SYSTEM_RULES = `You are texting on behalf of Bluebird Acquisition, a real-estate acquisitions company that buys distressed properties as-is for cash, subject-to, or novation. You are texting as {{AGENT_NAME}}.

TODAY'S DATE is {{TODAY}} — the only basis you have for turning something like "tomorrow" or "Thursday afternoon" into an actual date for the CALLBACK step below.

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

- Asked how a subject-to deal works, or assumes/asks whether they'd keep the house, stay on as the owner, or become a landlord: get this exactly right, it has been gotten backwards before. In a subject-to deal, WE take over the mortgage payments AND take ownership of the property — the existing loan just stays in place in the seller's name in the background rather than being paid off or refinanced. The seller does NOT keep ownership and is NOT "still the owner" afterward. If the seller wants to keep living in the property after closing, that is only possible as a tenant paying rent under a separate arrangement, never as the owner. Never tell a lead they "keep the house," "stay as the owner," or anything implying continued ownership in a subject-to deal.

- Their name and/or the property address are missing from WHAT YOU ACTUALLY KNOW above: get them confirmed before anything else, ahead of even step 1 of the framework. Ask naturally, not like an intake form ("Hey, this is {{AGENT_NAME}} — who am I speaking with, and just to confirm, is this about the property at [whatever address they mention, if any]?"). Once they answer, treat it as established fact for the rest of the conversation and move into the framework normally.

- Replies with "help", "please help", "need help", or similar (distinct from the bare compliance HELP keyword, which never reaches you): this is them saying they want to move forward, not a request for customer support. Don't ask "help with what?" — briefly acknowledge and go straight into the framework's next step.

- Negative or declining, or an explicit request to not be contacted again (in any phrasing, not just a bare "STOP" — plain STOP-style keywords are handled separately and never reach you): reply "Sorry to bother you, I won't reach out again." and set negative_reply true. Also set hard_decline:
  - false only if the decline is clearly and specifically about the price or offer amount (e.g. "too low", "not enough", "lowball", "insulting offer") and nothing else — not a refusal to sell at all, just this number. This stops you from texting them further without marking them permanently unreachable, since a different number or a human follow-up might still work.
  - true for every other kind of decline — not interested, wrong time, doesn't want to sell, tired of being contacted, or anything not clearly and only about price. If genuinely unsure which one this is, set hard_decline true: treat it as the permanent, safer option rather than guess.

FRAMEWORK for this lead:
{{FRAMEWORK}}

SUMMARY: whenever you set fully_qualified true, also fill in summary — a short, factual, labeled recap of what was actually established (motivation, condition, asking price and their reasoning if given, timeline, mortgage details if this is a lien-adjacent lead, and ownership status). This is what a human reads instead of rereading the whole thread, so be complete but not padded, and never invent or infer anything not actually said. Leave summary as an empty string whenever fully_qualified is false.

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
    .select(
      'id, user_id, first_name, last_name, address, city, state, zip, stage, notes, opted_out, ai_reply_paused, photo_wait_ai_active, lead_tags(tags(id, name))',
    )
    .eq('id', leadId)
    .single();

  if (!lead) return json({ aborted: true, reason: 'lead_not_found' });
  if (lead.opted_out) return json({ aborted: true, reason: 'opted_out' });

  // Qualified-plus normally means ai_reply_paused is true and stays true —
  // except Partial Qualified (initial_contact), which only ever got there
  // because everything but photos is already done. That transition still
  // sets ai_reply_paused true (the qualified-tasks trigger relies on that
  // exact flip to skip its own generic task pair), so photo_wait_ai_active is
  // a second, narrower flag: true only while the AI itself is still allowed
  // to chase photos/a callback time for this lead. A human manually replying
  // (useSendManualReply) clears it, which is what actually silences the AI
  // here — the stage never changes just because a human sent one message.
  const photoWaitActive = lead.stage === 'initial_contact' && lead.photo_wait_ai_active;
  if (lead.ai_reply_paused && !photoWaitActive) {
    return json({ aborted: true, reason: 'ai_reply_paused' });
  }

  // A lead can leave the AI-active part of the pipeline without
  // ai_reply_paused ever being set — a manual drag on the Kanban board, or a
  // deal actually handled by phone/Zoom-app and only reflected here after the
  // fact. The AI must never text a lead sitting in Qualified, Follow-Up,
  // Negotiation or any later stage regardless of how it got there, so this is
  // a second, independent gate rather than trusting ai_reply_paused alone.
  // initial_contact (Partial Qualified) is the one exception, gated above by
  // photoWaitActive rather than by stage alone — a lead landing there any
  // other way (a manual drag, say) has photo_wait_ai_active false and stays
  // silent same as before.
  const AI_ACTIVE_STAGES = new Set(['contacted', 'replied']);
  const isPhotoWaitMode = photoWaitActive; // already implies stage === 'initial_contact'
  if (!AI_ACTIVE_STAGES.has(lead.stage) && !isPhotoWaitMode) {
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
  // alongside or after the photos still gets answered. Photo-wait mode is the
  // one exception: a bare photo-only message is exactly the signal it exists
  // to catch, so it always continues through to promote the lead.
  const lastYouIdx = turns.map((t) => t.who).lastIndexOf('YOU');
  const unansweredLeadTurns = turns.slice(lastYouIdx + 1).filter((t) => t.who === 'LEAD');
  if (!isPhotoWaitMode && unansweredLeadTurns.length > 0 && unansweredLeadTurns.every((t) => !t.hasText)) {
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

  const { data: ownerProfile } = await admin.from('profiles').select('full_name').eq('id', lead.user_id).single();
  const agentName = ownerProfile?.full_name || 'the Bluebird team';

  // Anchors "tomorrow"/"Thursday"/etc for the CALLBACK step — without a
  // concrete today, the model has no basis to turn what the lead said into
  // an actual date. US Eastern, matching the single reference timezone
  // send-sms already anchors its own sending window to.
  const todayLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/New_York',
  });

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

  let system: string;
  if (isPhotoWaitMode) {
    // Step 5 (photo-wait mode): no framework to resolve — the interview is
    // already done, this is a fixed prompt with nothing tag- or
    // account-specific layered on.
    system = PHOTO_WAIT_SYSTEM.replace('{{AGENT_NAME}}', agentName)
      .replace('{{LEAD_CONTEXT}}', leadContext)
      .replace('{{TODAY}}', todayLabel);
  } else {
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
    const isTaxDelinquentLead = tagNames.some((n) => TAX_TAG_NAMES.includes(n.toLowerCase()));
    if (isTaxDelinquentLead) framework += TAX_ADDENDUM;
    // Unconditional — every framework, Default or any tag's own custom text,
    // gets the callback step appended regardless of what it already says.
    framework += CALLBACK_ADDENDUM;

    system = SYSTEM_RULES.replace('{{AGENT_NAME}}', agentName)
      .replace('{{LEAD_CONTEXT}}', leadContext)
      .replace('{{TODAY}}', todayLabel)
      .replace('{{FRAMEWORK}}', framework);
  }

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
        isPhotoWaitMode
          ? {
              name: 'draft_photo_wait_reply',
              description: "The SMS reply to send while this lead's only outstanding item is interior photos.",
              input_schema: {
                type: 'object',
                properties: {
                  reply_parts: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 1,
                    maxItems: 3,
                    description:
                      'The reply broken into separate short SMS messages, the way a real person actually texts — one thought per message rather than one long paragraph. Usually 1-2 messages, 3 only if genuinely needed.',
                  },
                  negative_reply: {
                    type: 'boolean',
                    description: 'True if the lead is now declining or asking not to be contacted.',
                  },
                  hard_decline: {
                    type: 'boolean',
                    description:
                      'Only meaningful when negative_reply is true. False only if the decline is clearly and specifically about the price/offer amount and nothing else. True for every other kind of decline, and true whenever unsure.',
                  },
                  scheduled_callback_at: {
                    type: 'string',
                    description:
                      'Only fill in on the message where they actually name a specific day and time to call them about the offer — empty string otherwise, including every earlier turn where you\'ve only asked but not yet gotten a real answer. An ISO 8601 date-time (YYYY-MM-DDTHH:MM:SS, no timezone) computed from TODAY\'S DATE. If they gave a day but no specific time (or vice versa), use your best reasonable estimate (e.g. "tomorrow morning" -> 09:00:00) rather than leaving it blank.',
                  },
                  scheduled_callback_note: {
                    type: 'string',
                    description:
                      'Only fill in together with scheduled_callback_at, on that same message. The callback time in their own words, e.g. "Tomorrow around 3pm" — for a human to read alongside the parsed time.',
                  },
                },
                required: ['reply_parts', 'negative_reply'],
              },
            }
          : {
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
                      "Only meaningful when fully_qualified is true — empty string otherwise. A concise, factual, labeled recap (motivation, condition, price, timeline, mortgage details if applicable, ownership status) of what the seller actually said, for a human reading it later without rereading the whole thread. Never invent or infer anything not actually said.",
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
                  scheduled_callback_at: {
                    type: 'string',
                    description:
                      'Only fill in on the message where they actually name a specific day and time to call them back (the CALLBACK step) — empty string otherwise, including every earlier turn where you\'ve only asked but not yet gotten a real answer. An ISO 8601 date-time (YYYY-MM-DDTHH:MM:SS, no timezone) computed from TODAY\'S DATE above and what they said, e.g. today being a Wednesday and them saying "tomorrow at 3pm" becomes tomorrow\'s date at 15:00:00. If they gave a day but no specific time (or vice versa), use your best reasonable estimate (e.g. "tomorrow morning" -> 09:00:00) rather than leaving it blank.',
                  },
                  scheduled_callback_note: {
                    type: 'string',
                    description:
                      'Only fill in together with scheduled_callback_at, on that same message. The callback time in their own words, e.g. "Tomorrow around 3pm" or "Thursday morning" — for a human to read alongside the parsed time.',
                  },
                  next_action: {
                    type: 'string',
                    description:
                      'Only meaningful when fully_qualified is true — empty string otherwise. One concrete, specific next step for a human to do, informed by what was actually said in this conversation, not a generic template. E.g. "Run comps and confirm an offer near her $210k ask, roof is 20 years old" or "Text the LOI for a subject-to deal at $180k, he agreed to the number on the call" or "Call to finalize numbers before Friday, she has another offer to compare against". Always name what makes THIS lead specific (a number mentioned, a deadline, a condition issue) rather than restating the framework steps.',
                  },
                },
                required: ['reply_parts', 'fully_qualified', 'negative_reply'],
              },
            },
      ],
      tool_choice: { type: 'tool', name: isPhotoWaitMode ? 'draft_photo_wait_reply' : 'draft_reply' },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!aiRes.ok) {
    const errText = await aiRes.text();
    if (triggerMessageId) {
      await admin.from('inbound_messages').update({ send_error: `Anthropic error: ${errText.slice(0, 500)}` }).eq('id', triggerMessageId);
    }
    return json({ error: `Anthropic error (${aiRes.status})` }, 502);
  }

  const aiData = await aiRes.json();
  const toolUse = (aiData.content ?? []).find(
    (c: any) => c.type === 'tool_use' && c.name === (isPhotoWaitMode ? 'draft_photo_wait_reply' : 'draft_reply'),
  );
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
    scheduled_callback_at: scheduledCallbackAtRaw,
    scheduled_callback_note: scheduledCallbackNote,
    next_action: nextAction,
  } = toolUse.input as {
    reply_parts: string[];
    // Absent entirely from the photo-wait tool's schema — undefined there,
    // which is falsy and correctly skips the fully_qualified branch below.
    fully_qualified?: boolean;
    negative_reply: boolean;
    hard_decline?: boolean;
    summary?: string;
    confirmed_first_name?: string;
    confirmed_address?: string;
    scheduled_callback_at?: string;
    scheduled_callback_note?: string;
    next_action?: string;
  };

  // Fills in a name/address the CRM never had, and a callback time once the
  // seller actually gives one — all independent of qualification outcome,
  // since any of these can land on a message that doesn't itself complete
  // the framework.
  const recoveredFields: Record<string, unknown> = {};
  if (confirmedFirstName?.trim() && !lead.first_name) recoveredFields.first_name = confirmedFirstName.trim();
  if (confirmedAddress?.trim() && !lead.address) recoveredFields.address = confirmedAddress.trim();
  if (scheduledCallbackAtRaw?.trim()) {
    const parsed = new Date(scheduledCallbackAtRaw.trim());
    if (!isNaN(parsed.getTime())) {
      recoveredFields.scheduled_callback_at = parsed.toISOString();
      recoveredFields.scheduled_callback_note = scheduledCallbackNote?.trim() || null;
    }
  }
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
      // Only the price-specific decline — a human revisiting later with a
      // different number or offer is the whole reason this goes On Hold
      // instead of Dead, so that revisit needs its own task or it's easy to
      // forget this lead is still workable.
      await admin.from('tasks').insert({
        user_id: lead.user_id,
        lead_id: leadId,
        title: `Message ${lead.first_name || 'lead'} with a revised offer — declined on price, may still be workable`,
        due_date: new Date().toISOString().slice(0, 10),
        auto_created: true,
      });
    }
  } else if (fullyQualified) {
    const landingOnFollowup = hasPhotos as boolean;
    const updates: Record<string, unknown> = {
      stage: landingOnFollowup ? 'followup' : 'initial_contact',
      ai_reply_paused: true,
      // Only Partial Qualified (no photos yet) leaves the AI able to keep
      // texting this lead — photo-wait mode above is gated on this flag
      // alongside stage. Landing straight on Follow-Up means photos were
      // already in hand, so there's nothing left for the AI to do.
      photo_wait_ai_active: !landingOnFollowup,
    };

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

    // One task, written from what was actually said in this conversation —
    // not the generic "run the numbers" pair the DB trigger creates for
    // every OTHER path a lead can reach a qualified-plus stage through
    // (Kanban drag, the profile's stage dropdown, a call outcome). The
    // trigger (handle_lead_qualified_tasks) detects this exact branch — the
    // same update that also flips ai_reply_paused true — and skips its own
    // generic pair specifically so a lead qualified over text doesn't end up
    // with three tasks instead of one.
    await admin.from('tasks').insert({
      user_id: lead.user_id,
      lead_id: leadId,
      title: nextAction?.trim() || `Follow up with ${lead.first_name || 'lead'} — confirm numbers and next steps`,
      due_date: new Date().toISOString().slice(0, 10),
      auto_created: true,
    });
  } else if (isPhotoWaitMode && hasPhotos && recoveredFields.scheduled_callback_at) {
    // Partial Qualified was waiting on two things, in order: photos, then a
    // real time to call about the offer. Photos alone used to promote
    // straight to Follow-Up here; now it also needs that callback time
    // actually captured on this same turn (or a later one — the AI keeps
    // asking every turn until it gets a real answer, same as the main
    // framework's own CALLBACK step). No qualification task needed here —
    // the one written when this lead first became qualified still covers
    // it; the callback task inserted below is the new, concrete thing.
    await admin
      .from('leads')
      .update({ stage: 'followup', photo_wait_ai_active: false, next_reminder_at: null })
      .eq('id', leadId);
  }

  // Independent of the branch above — a callback time can land on the same
  // turn fully_qualified does (the usual case, per the CALLBACK step), but
  // nothing here depends on that; any turn that actually captures one gets
  // its own task so it shows up as something concrete to act on. In
  // photo-wait mode this callback is specifically the post-photos offer
  // call (see the branch above), so the task says that rather than the
  // generic "call back" — an admin scanning tasks shouldn't have to guess
  // which kind of call this is.
  if (recoveredFields.scheduled_callback_at) {
    const isOfferCallback = isPhotoWaitMode && hasPhotos;
    await admin.from('tasks').insert({
      user_id: lead.user_id,
      lead_id: leadId,
      title: isOfferCallback
        ? `Call ${lead.first_name || 'lead'} to go over the offer${scheduledCallbackNote?.trim() ? ` — ${scheduledCallbackNote.trim()}` : ''}`
        : `Call back ${lead.first_name || 'lead'}${scheduledCallbackNote?.trim() ? ` — ${scheduledCallbackNote.trim()}` : ''}`,
      due_date: String(recoveredFields.scheduled_callback_at).slice(0, 10),
      auto_created: true,
    });
  }

  // Asked for photos, still don't have them — only Replied (mid-interview)
  // and Qualified (fully_qualified without hasPhotos lands here, see the
  // stage above) ever actually need this nudge; Follow-Up+ already has
  // photos by definition. Deterministic rather than left to next_action's
  // own judgment, since this is exactly the concrete gap that's easy for a
  // model to gloss over, and de-duped against any already-open one so it
  // doesn't re-insert on every single follow-up message in the thread.
  const stageNow = fullyQualified ? (hasPhotos as boolean ? 'followup' : 'initial_contact') : lead.stage;
  if (!hasPhotos && (stageNow === 'replied' || stageNow === 'initial_contact')) {
    const askedForPhotos = turns.some((t) => t.who === 'YOU' && /photo|pictur/i.test(t.body));
    if (askedForPhotos) {
      const { count: alreadyHasOne } = await admin
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('lead_id', leadId)
        .eq('completed', false)
        .ilike('title', '%photo%');
      if (!alreadyHasOne) {
        await admin.from('tasks').insert({
          user_id: lead.user_id,
          lead_id: leadId,
          title: `Get photos from ${lead.first_name || 'lead'} — asked but not received yet`,
          due_date: new Date().toISOString().slice(0, 10),
          auto_created: true,
        });
      }
    }
  }

  return json({ ok: true, sent: true, fullyQualified, negativeReply, hardDecline: negativeReply ? hardDecline : undefined });
});
