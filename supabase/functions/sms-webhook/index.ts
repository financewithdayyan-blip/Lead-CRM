// Edge Function: sms-webhook
//
// Receives Zoom's phone.sms_received event. Public and unauthenticated by
// necessity (Zoom calls this, not a logged-in user) — everything here has to
// defend itself rather than trust the caller, via signature verification.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('ZOOM_WEBHOOK_SECRET_TOKEN')!;
// 217-408-2781 — NUMBERS['2'] in the outreach pool (send-sms), reused by
// Blue Docs rather than a separate dedicated line. See
// create-contract-instance's own comment on this.
const BLUEDOCS_PHONE_NORM = (Deno.env.get('ZOOM_FROM_NUMBER_2') ?? '').replace(/[^0-9]/g, '').slice(-10);

// Phone only — mirrors the same slots in send-sms/ai-reply, but this
// function never sends, only needs to recognize which of the 6 numbers a
// recovered send_log row went out from.
const NUMBER_PHONES: Record<string, string> = {
  '1': Deno.env.get('ZOOM_FROM_NUMBER') ?? '',
  '2': Deno.env.get('ZOOM_FROM_NUMBER_2') ?? '',
  '3': Deno.env.get('ZOOM_FROM_NUMBER_3') ?? '',
  '4': Deno.env.get('ZOOM_FROM_NUMBER_4') ?? '',
  '5': Deno.env.get('ZOOM_FROM_NUMBER_5') ?? '',
  '6': Deno.env.get('ZOOM_FROM_NUMBER_6') ?? '',
};

function keyForSentFrom(sentFrom: string): string | undefined {
  const digits = sentFrom.replace(/[^0-9]/g, '').slice(-10);
  return Object.entries(NUMBER_PHONES).find(([, phone]) => phone.replace(/[^0-9]/g, '').slice(-10) === digits)?.[0];
}

function guessContentType(name: string): string {
  switch (name.split('.').pop()?.toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'heic':
      return 'image/heic';
    default:
      return 'application/octet-stream';
  }
}

/** Zoom's inbound attachment download_url is a JWT-signed link that expires
 * ~30 minutes after the webhook fires (confirmed against a real payload's
 * iat/exp) — fine to read right now, useless by the time anyone opens the
 * lead's SMS thread later. Re-hosted into the same private lead-files
 * bucket the lead's Files tab already uses, keyed by storage_path instead
 * of the dead Zoom URL, so it can be signed on demand whenever the thread
 * is actually viewed. Best-effort per attachment — one failed download
 * shouldn't lose the rest or fail the whole webhook. */
async function rehostAttachments(
  admin: ReturnType<typeof createClient>,
  attachments: any[],
  userId: string,
  leadId: string,
  messageId: string,
): Promise<void> {
  const rehosted = await Promise.all(
    attachments.map(async (att, i) => {
      try {
        const res = await fetch(att.download_url);
        if (!res.ok) throw new Error(`download failed: ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const safeName = (att.name as string) || `attachment-${i}`;
        const path = `${userId}/${leadId}/mms-${messageId}-${i}-${safeName}`;
        const { error: uploadErr } = await admin.storage
          .from('lead-files')
          .upload(path, bytes, { contentType: guessContentType(safeName), upsert: true });
        if (uploadErr) throw uploadErr;
        const { download_url: _dropped, ...rest } = att;
        return { ...rest, storage_path: path };
      } catch (e) {
        console.error(`MMS re-host failed for message ${messageId} attachment ${i}:`, e);
        return att;
      }
    }),
  );
  await admin.from('inbound_messages').update({ attachments: rehosted }).eq('id', messageId);
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-zm-signature, x-zm-request-timestamp',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// ── HMAC-SHA256, hex-encoded ────────────────────────────────────────────────

async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Reaction detection ──────────────────────────────────────────────────────

/**
 * Carrier-bridged tapback reactions ("👍 to \"our text\"", "Removed 👍 from
 * \"our text\"") arrive through this same webhook as an ordinary inbound SMS.
 * They are not replies — without this filter, a reaction and its removal each
 * independently trigger a fresh AI draft answering a message the lead never
 * actually sent.
 */
function isReactionMessage(body: string): boolean {
  const trimmed = body.trim();
  return /^(Liked|Loved|Disliked|Laughed at|Emphasized|Questioned|Removed\s+\S+\s+from|.{1,4}\s+to)\s+["“]/i.test(trimmed)
    || /^(Removed\s+)?\p{Emoji_Presentation}\s*(to|from)\s+["“]/u.test(trimmed);
}

// ── Deterministic no-AI-cost paths ──────────────────────────────────────────
// Each of these three ends the conversation without an AI call: skip drafting
// entirely, send no reply, mark the lead Dead + opted_out + paused. Getting
// the detection right matters more than usual here — a false positive
// silently kills a real lead with no reply and no visibility, worse than the
// cost of one wasted AI call, so every pattern below is deliberately narrow.

/** Whole trimmed message only — "I want to stop looking at properties" must never match. */
const HARD_STOP_KEYWORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit']);

function isHardStopKeyword(body: string): boolean {
  const normalized = body.trim().toLowerCase().replace(/[.!?]+$/, '');
  return HARD_STOP_KEYWORDS.has(normalized);
}

/**
 * Plain-English opt-out phrases, anchored to the END of the message so a
 * phrase embedded in an unrelated sentence can't match. A handful of trailing
 * softener words (again/anymore/please) are stripped before the suffix check,
 * so "don't text me again" still matches the core phrase "don't text me".
 *
 * Verified against both required negative cases: "don't call me before 9am"
 * (different verb, and trailing content after "me" blocks the anchor) and
 * "remove my number, use this new one instead" (trailing content after the
 * phrase blocks the anchor) — neither matches.
 */
const DECLINE_CORE_PHRASES = [
  "don't text me",
  'do not text me',
  'stop texting me',
  'do not contact me',
  "don't contact me",
  'remove my number',
  'take me off your list',
  'take me off the list',
];
const TRAILING_SOFTENERS = ['again', 'anymore', 'please'];

function isDeclinePhrase(body: string): boolean {
  let s = body.trim().toLowerCase().replace(/[.!?]+$/, '').trim();
  // Strip up to two trailing softeners (e.g. "again please").
  for (let i = 0; i < 2; i++) {
    const match = TRAILING_SOFTENERS.find((w) => s.endsWith(` ${w}`));
    if (!match) break;
    s = s.slice(0, s.length - match.length - 1).replace(/[.!?]+$/, '').trim();
  }
  return DECLINE_CORE_PHRASES.some((phrase) => s.endsWith(phrase));
}

/**
 * Curated profanity word list rather than a broad wildcard, so "fork",
 * "funk", "stuck", "duck" and "truck" can never match. Word-boundary anchored.
 * Unlike the decline phrases, hostility doesn't need end-anchoring — there is
 * no benign reading of directing profanity at a cold-outreach text.
 */
const PROFANITY_PATTERN = /\b(fuck|f\*ck|f\*\*k|fck|fuk)\b/i;

function isProfanity(body: string): boolean {
  return PROFANITY_PATTERN.test(body);
}

// ── Phone normalisation ─────────────────────────────────────────────────────

/** Zoom sends digits with no leading +. Match leads.phone_norm's shape: last 10 digits. */
function normalizePhone(raw: string): string {
  return raw.replace(/[^0-9]/g, '').slice(-10);
}

// ── Field extraction ─────────────────────────────────────────────────────────

/**
 * Zoom's inbound-SMS payload field names aren't pinned down with certainty
 * without a live delivery to inspect, so every field is read with fallbacks
 * and the full raw payload is always stored in webhook_log regardless of
 * whether parsing below succeeds. If a field name is wrong, nothing is lost —
 * it's visible in the log and this function gets corrected from there.
 */
function pick(obj: any, ...keys: string[]): string | undefined {
  for (const k of keys) {
    if (obj?.[k] != null && obj[k] !== '') return String(obj[k]);
  }
  return undefined;
}

// ── Lead resolution ──────────────────────────────────────────────────────

/**
 * Duplicate leads sharing the same phone number are common in this data
 * (repeated CSV imports without dedup — 522 phone numbers across 1,044
 * leads at last count), so a phone-number match can return more than one
 * candidate. When it does, disambiguate using whichever candidate's own
 * property address was actually mentioned in something sent to this
 * number — a bulk send's {{address}} placeholder puts the exact address
 * text into send_log.body, which is a far stronger signal than guessing.
 * Falls back to the oldest lead (the first entered for a contact is
 * normally the canonical one) when there's no address signal, or an
 * ambiguous one (e.g. two duplicates for the same property).
 */
async function resolveLead(admin: ReturnType<typeof createClient>, fromNorm: string) {
  if (fromNorm.length !== 10) return undefined;

  const { data: candidates } = await admin
    .from('leads')
    .select('id, stage, user_id, address, created_at, assigned_sms_number')
    .or(`phone_norm.eq.${fromNorm},phone2_norm.eq.${fromNorm}`)
    .order('created_at', { ascending: true });

  if (!candidates || candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  const { data: sent } = await admin.from('send_log').select('body').eq('phone_norm', fromNorm);
  const bodies = (sent ?? []).map((s) => (s.body || '').toLowerCase());

  const addressMatches = candidates.filter(
    (c) => c.address?.trim() && bodies.some((b) => b.includes(c.address!.trim().toLowerCase())),
  );

  return addressMatches.length === 1 ? addressMatches[0] : candidates[0];
}

// ── Buyer resolution ─────────────────────────────────────────────────────

/**
 * Checked only after resolveLead finds nothing — a lead's own ongoing
 * conversation is never redirected to a buyer match just because the same
 * phone number happens to also be in the cash_buyers roster. Unlike leads,
 * buyer phone numbers aren't expected to collide (a small, manually curated
 * roster, not a bulk-imported list), so no disambiguation step is needed.
 */
async function resolveBuyer(admin: ReturnType<typeof createClient>, fromNorm: string) {
  if (fromNorm.length !== 10) return undefined;
  const { data } = await admin
    .from('cash_buyers')
    .select('id, assigned_sms_number')
    .eq('phone_norm', fromNorm)
    .limit(1)
    .maybeSingle();
  return data ?? undefined;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const rawBody = await req.text();
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let event: any;
  try {
    event = JSON.parse(rawBody || '{}');
  } catch {
    await admin.from('webhook_log').insert({ event_type: 'unparseable', payload: { rawBody }, error: 'invalid JSON' });
    return json({ error: 'invalid JSON' }, 400);
  }

  // ── Zoom's endpoint validation handshake ──────────────────────────────────
  // Runs once when the URL is registered in the Zoom app, unsigned, so it is
  // handled before any signature check.
  if (event.event === 'endpoint.url_validation') {
    const plainToken = event.payload?.plainToken;
    if (!plainToken) return json({ error: 'missing plainToken' }, 400);
    const encryptedToken = await hmacHex(plainToken, WEBHOOK_SECRET);
    await admin.from('webhook_log').insert({ event_type: event.event, signature_valid: true, payload: event });
    return json({ plainToken, encryptedToken });
  }

  // ── Signature verification for every other event ──────────────────────────
  const signature = req.headers.get('x-zm-signature') ?? '';
  const timestamp = req.headers.get('x-zm-request-timestamp') ?? '';
  const expected = `v0=${await hmacHex(`v0:${timestamp}:${rawBody}`, WEBHOOK_SECRET)}`;
  const validSignature = signature === expected;

  await admin.from('webhook_log').insert({
    event_type: event.event ?? 'unknown',
    signature_valid: validSignature,
    payload: event,
  });

  if (!validSignature) {
    return json({ error: 'invalid signature' }, 401);
  }

  if (event.event !== 'phone.sms_received') {
    // Logged above; nothing further to do for events this function doesn't
    // act on.
    return json({ ok: true });
  }

  try {
    const obj = event.payload?.object ?? event.payload ?? {};
    // Confirmed against a real delivery: the number is nested under sender /
    // to_members, not a flat field. Flat fallbacks are kept in case Zoom's
    // shape ever varies by event sub-type, but the nested path is primary.
    const fromRaw =
      pick(obj.sender ?? {}, 'phone_number') ??
      pick(obj, 'from_phone_number', 'from_number', 'sender_number', 'from') ??
      '';
    const toRaw =
      pick(obj.to_members?.[0] ?? {}, 'phone_number') ??
      pick(obj, 'to_phone_number', 'to_number', 'receiver_number', 'to') ??
      '';
    const body = pick(obj, 'message', 'body', 'content', 'text') ?? '';
    const zoomMessageId = pick(obj, 'message_id', 'id', 'sms_id');
    const attachments = Array.isArray(obj.attachments) ? obj.attachments : [];

    const fromNorm = normalizePhone(fromRaw);
    const reaction = isReactionMessage(body);

    // Dedupe Zoom's retried deliveries. unique constraint + ignore-on-conflict
    // means a retry is a harmless no-op rather than a second row or a thrown
    // error that would make Zoom retry again.
    const { data: inserted, error: insertErr } = await admin
      .from('inbound_messages')
      .insert({
        from_phone: fromRaw,
        to_phone: toRaw,
        body,
        zoom_message_id: zoomMessageId ?? null,
        has_attachments: attachments.length > 0,
        attachments,
        is_reaction: reaction,
      })
      .select('id, received_at')
      .single();

    if (insertErr) {
      // A unique-violation on zoom_message_id is an expected retry, not a
      // failure — anything else gets recorded so it's visible.
      if (insertErr.code !== '23505') {
        await admin.from('webhook_log').insert({
          event_type: 'phone.sms_received.error',
          payload: event,
          error: insertErr.message,
        });
      }
      return json({ ok: true });
    }

    // Reactions stop here entirely — no lead match needed, no stage change,
    // and (once Phase 4 exists) no AI call.
    if (reaction) return json({ ok: true, reaction: true });

    // Blue Docs shares this number with lead outreach (one number, not a
    // dedicated one) — so a reply from someone who's already a recognized
    // lead must keep flowing through the normal resolveLead/AI-reply path
    // below exactly as before. This only ever matters for the narrower case
    // resolveLead can't already handle: someone with no lead record at all
    // (a witness, a co-buyer, an attorney) replying about a document —
    // without this, createLeadFromUnmatched would otherwise happily turn
    // that reply into a fake sales lead. Checked as part of the "unmatched"
    // fallback below, not unconditionally, so a real lead's own ongoing
    // conversation is never hijacked just because they once signed something
    // on this number.
    async function blueDocsSigningReplyOrUndefined(): Promise<boolean> {
      const toNorm = normalizePhone(toRaw);
      if (!BLUEDOCS_PHONE_NORM || toNorm !== BLUEDOCS_PHONE_NORM) return false;
      const { data: signingParty } = await admin
        .from('contract_signing_parties')
        .select('id, name, contract_instance_id, contract_instances(name)')
        .eq('phone_norm', fromNorm)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!signingParty) return false;

      const { data: admins } = await admin.from('profiles').select('id').eq('role', 'admin');
      if (admins?.length) {
        const docName = (signingParty as any).contract_instances?.name ?? 'a document';
        await admin.from('lc_notifications').insert(
          admins.map((a) => ({
            user_id: a.id,
            type: 'contract_sms_reply',
            title: `${signingParty.name} replied about ${docName}`,
            body: body || '(no message text)',
          })),
        );
      }
      return true;
    }

    // Never attempt a match on a blank or malformed number. An empty fromNorm
    // in an .or() filter is a real value to compare against, not "match
    // nothing" — it can and did silently attach a real conversation to an
    // unrelated lead whose own number was blank. A short-circuit here is the
    // difference between "no match" and "wrong match". See resolveLead for
    // how a phone number matching more than one lead gets disambiguated.
    const lead = await resolveLead(admin, fromNorm);
    if (!lead && fromNorm.length === 10) {
      // No recognized lead. Check whether this is actually a Blue Docs
      // signer with no lead record at all — otherwise, deliberately do
      // nothing further: the AI must never engage with a number that isn't
      // a real lead already in the CRM (personal contacts, business calls,
      // anyone reached outside the normal outreach flow). The message still
      // gets logged in inbound_messages above with lead_id null; no lead
      // gets fabricated for it and ai-reply never fires, since that's gated
      // entirely on a resolved lead below.
      if (await blueDocsSigningReplyOrUndefined()) return json({ ok: true, signingReply: true });

      // Not a lead, not a Blue Docs signer — last check before giving up:
      // a cash buyer texting back. No AI involvement here at all, just
      // logging the reply into their own thread for an admin to read.
      const buyer = await resolveBuyer(admin, fromNorm);
      if (buyer) {
        if (isHardStopKeyword(body) || isDeclinePhrase(body)) {
          await admin.from('cash_buyers').update({ sms_opted_out: true }).eq('id', buyer.id);
        }
        await admin.from('buyer_messages').insert({
          buyer_id: buyer.id,
          direction: 'inbound',
          body,
          from_phone: fromRaw,
          to_phone: toRaw,
          zoom_message_id: zoomMessageId ?? null,
        });
        const inboundKey = keyForSentFrom(toRaw);
        if (inboundKey && (buyer as { assigned_sms_number?: string | null }).assigned_sms_number !== inboundKey) {
          await admin.from('cash_buyers').update({ assigned_sms_number: inboundKey }).eq('id', buyer.id);
        }
        return json({ ok: true, buyerMatched: true });
      }
    }
    if (lead) {
      await admin.from('inbound_messages').update({ lead_id: lead.id }).eq('id', inserted.id);

      if (attachments.length > 0) {
        await rehostAttachments(admin, attachments, lead.user_id, lead.id, inserted.id);
      }

      // Pin the number this thread actually lives on the moment we see real
      // inbound traffic, not just on the first outbound send — otherwise a
      // lead that's still ai_reply_paused (or waiting on the 16s debounce)
      // when this text arrives shows the 6-button picker instead of a real
      // number until something happens to trigger a send.
      const inboundKey = keyForSentFrom(toRaw);
      if (inboundKey && (lead as { assigned_sms_number?: string | null }).assigned_sms_number !== inboundKey) {
        await admin.from('leads').update({ assigned_sms_number: inboundKey }).eq('id', lead.id);
      }

      // Deterministic paths — checked before anything else touches this lead.
      // Each ends the conversation without ever reaching the AI: no draft, no
      // reply, straight to Dead + opted_out + paused.
      const deterministicStop = isHardStopKeyword(body) || isDeclinePhrase(body) || isProfanity(body);

      if (deterministicStop) {
        await admin
          .from('leads')
          .update({ stage: 'dead_declined', opted_out: true, ai_reply_paused: true })
          .eq('id', lead.id);
        await admin.from('lead_activities').insert({
          lead_id: lead.id,
          user_id: lead.user_id,
          type: 'sms',
          body,
          meta: { direction: 'inbound', from: fromRaw, to: toRaw, hasAttachments: attachments.length > 0, autoOptOut: true },
        });
        return json({ ok: true, matched: true, optedOut: true });
      }

      // Only advance forward. A lead already past 'replied' (in Negotiation,
      // say) shouldn't be pulled backward by a new inbound text.
      const ADVANCE_FROM = new Set(['new', 'voicemail', 'contacted']);
      if (ADVANCE_FROM.has(lead.stage)) {
        await admin.from('leads').update({ stage: 'replied' }).eq('id', lead.id);
      }

      await admin.from('lead_activities').insert({
        lead_id: lead.id,
        // lead_activities.user_id is not-null; attributed to the lead's own
        // owner since no human admin is "acting" on an inbound webhook.
        user_id: lead.user_id,
        type: 'sms',
        body,
        meta: { direction: 'inbound', from: fromRaw, to: toRaw, hasAttachments: attachments.length > 0 },
      });

      // Hand off to the AI engine as an independent, later invocation — do
      // not await it here. This function must return to Zoom quickly, and
      // the debounce logic inside ai-reply is specifically designed to work
      // across separate invocations with no shared state, keyed only on
      // "does a newer inbound_messages row exist for this lead" at wake time.
      const triggerAi = fetch(`${SUPABASE_URL}/functions/v1/ai-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': SERVICE_ROLE_KEY },
        body: JSON.stringify({
          leadId: lead.id,
          triggerMessageId: inserted.id,
          triggerReceivedAt: inserted.received_at,
        }),
      }).catch(() => {});

      // EdgeRuntime.waitUntil keeps this invocation alive to finish that
      // fetch after the response below has already gone back to Zoom.
      // @ts-ignore -- Supabase/Deno Deploy global, not in the standard lib types.
      if (typeof EdgeRuntime !== 'undefined') {
        // @ts-ignore
        EdgeRuntime.waitUntil(triggerAi);
      } else {
        await triggerAi;
      }
    }

    return json({ ok: true, matched: !!lead });
  } catch (e) {
    await admin.from('webhook_log').insert({
      event_type: 'phone.sms_received.exception',
      payload: event,
      error: e instanceof Error ? e.message : String(e),
    });
    // Still 200 — Zoom will retry a non-2xx, and the failure is already
    // captured above for debugging.
    return json({ ok: true });
  }
});
