// Edge Function: auto-score-leads
//
// Re-scores every lead currently sitting in Partial Qualified, Qualified,
// Negotiation, or Contract — the stages where a seller has actually engaged
// enough for a score to mean something, and where the score genuinely
// changes over time as the conversation moves. Runs twice a week, Monday
// and Thursday (see migration 0118), via pg_cron -> pg_net — same shape as
// ai-reply-review/contract-reminder-sweep: an x-internal-secret header
// pulled from Vault, never the service role key, so a rotated/leaked key
// can't silently double as cron auth.
//
// The scoring logic itself (prompt, context assembly, tool schema) is
// duplicated from score-lead/index.ts rather than imported — this
// codebase's own established convention for edge functions (see the Zoom
// helper duplication notes in send-sms/create-contract-instance/
// submit-signature). Keep the two in sync by hand if the rubric changes.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
// A purpose-made secret, not SUPABASE_SERVICE_ROLE_KEY — see ai-reply-review's
// own note on why (deployed edge functions resolve that env var to a
// different key format than what a Vault-stored copy set earlier holds).
const CRON_SECRET = Deno.env.get('AUTO_SCORE_CRON_SECRET')!;

function isAuthorizedCaller(req: Request): boolean {
  return req.headers.get('x-internal-secret') === CRON_SECRET;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const FETCH_TIMEOUT_MS = 45_000;
function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timed out waiting on ${label}`)), FETCH_TIMEOUT_MS)),
  ]);
}

// Stages where the seller has engaged enough for a score to be meaningful —
// matches the Kanban labels: Partial Qualified, Qualified, Negotiation,
// Contract. Earlier stages (Cold Lead, Contacted, Replied) skip this batch
// entirely; an admin can still score one of those on demand via score-lead.
const SCORE_STAGES = ['initial_contact', 'followup', 'negotiation', 'contract'];

// Caps how much one run can ever do, same reasoning as ai-reply-review's own
// cap: keeps this comfortably inside the edge runtime's execution limit
// regardless of how large the pipeline grows. If the pipeline ever exceeds
// this between Monday and Thursday, the leftover leads simply pick up their
// updated score on the next scheduled run rather than this run timing out.
const MAX_LEADS_PER_RUN = 60;
const CONCURRENCY = 3;

function money(n: unknown): string | null {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v === 0) return null;
  return `$${Math.round(v).toLocaleString()}`;
}

// Kept byte-identical to score-lead/index.ts's own copy.
const SCRIPT_ANSWER_LABELS: Record<string, string> = {
  confirmation_owner: 'Owner confirmation',
  motivation_owned: 'Time owned',
  motivation_reason: 'Motivation',
  condition_general: 'General condition',
  condition_rating: 'Self-rated condition',
  condition_issues: 'Other issues',
  condition_hvac: 'HVAC',
  condition_electrical: 'Electrical',
  condition_plumbing: 'Plumbing',
  condition_roof: 'Roof age',
  condition_foundation: 'Foundation',
  condition_leaks: 'Leaks/water damage',
  condition_mold: 'Mold',
  timeline: 'Timeline to close',
  price_asking: 'Asking price (stated)',
  price_reasoning: 'How they got that number',
  mortgage_payment: 'Mortgage payment',
  mortgage_balance: 'Mortgage balance',
  mortgage_rate: 'Mortgage rate',
  mortgage_statement: 'Mortgage statement',
  decision: 'Decision makers',
  photo_request: 'Photos',
  callback: 'Callback time',
};

const SCORING_SYSTEM = `You are a real-estate acquisitions analyst for Bluebird Acquisition, a company that buys distressed properties as-is for cash, subject-to, or novation deals. Score how strong an acquisition candidate this lead is, from 0 (dead, no realistic path to a profitable deal) to 100 (urgent, cooperative seller, deeply discounted price, no red flags).

Weigh these, in this order of importance:

1. THE ACTUAL SMS CONVERSATION, both sides — this is your primary evidence, more important than any static field. Read it for:
   - Real motivation and urgency in the seller's own words, not just whether a "motivation" field exists. A specific, time-pressured reason (foreclosure, divorce, inherited property they don't want, behind on payments, out-of-state landlord done dealing with it) scores far higher than a vague "just thinking about it."
   - Engagement and responsiveness — replying promptly and volunteering detail is a green flag; one-word answers, long gaps, or having to be dragged through every question is a red flag.
   - Price realism and flexibility — a seller anchored to a retail/Zillow number for a distressed property, or unwilling to acknowledge the property needs work, is a red flag. One who wants a fast, certain, as-is sale and is open on price is a green flag.
   - Any explicit decline, hesitation, stalling, or disappearing act.

2. CALL AND NOTE HISTORY — phone conversations often surface real negotiation context (a number discussed, an objection, a stall, a decision-maker issue) that never appears in the text thread at all. Weigh this alongside the SMS thread, not as an afterthought.

3. PROPERTY & FINANCIAL DATA — condition, repairs needed, and critically the margin between ARV and asking price (or our own min/max offer range) if both are known. A thin or negative margin caps the score regardless of how motivated the seller sounds, since there's no deal to be had.

4. PIPELINE STAGE — a secondary, tie-breaking signal only. A highly engaged lead still early in the pipeline can and should outscore a stalled, unresponsive lead sitting in a later stage. Never let stage alone drive the score.

If there is little or no real SMS conversation yet (e.g. just contacted, no reply), do not inflate the score from property fields or stage alone — say so plainly in your reasoning and score conservatively (roughly 15-40 depending on how promising the raw property data is), since an unvalidated lead is not yet a real prospect no matter how complete its file is.

If the lead is marked Dead/Declined, explain why from the actual conversation (hard decline, wrong number, price objection only, went cold, etc.) and score low — under 20 — unless the conversation shows the decline was narrowly about price and the seller otherwise seemed open, in which case score it as a longer-shot prospect instead (worth revisiting) rather than a dead 0.

Write reasoning as 2-4 tight sentences, citing specifics from what this particular lead actually said or didn't say (their stated reason, a number mentioned, how they've been responding) — never generic boilerplate that could apply to any lead, and never just restate the score back in words.`;

function scoringUserMessage(opts: {
  propertyBlock: string;
  scriptAnswersBlock: string;
  callContext: string;
  transcript: string;
  hasTranscript: boolean;
}): string {
  const parts: string[] = [];
  parts.push(`PROPERTY, FINANCIALS & PIPELINE STATE:\n${opts.propertyBlock}`);
  if (opts.scriptAnswersBlock) parts.push(`STRUCTURED INTERVIEW ANSWERS ON FILE:\n${opts.scriptAnswersBlock}`);
  if (opts.callContext) parts.push(`CALL / NOTE HISTORY:\n${opts.callContext}`);
  parts.push(
    opts.hasTranscript
      ? `FULL SMS CONVERSATION (LEAD = the seller, YOU = Bluebird):\n${opts.transcript}`
      : `FULL SMS CONVERSATION: none yet — this lead has not exchanged any text messages.`,
  );
  parts.push('Score this lead and call score_lead with your judgment.');
  return parts.join('\n\n');
}

async function scoreOneLead(admin: ReturnType<typeof createClient>, leadId: string): Promise<{ score: number }> {
  const { data: lead, error: leadError } = await admin
    .from('leads')
    .select(
      'id, first_name, last_name, address, city, state, zip, prop_type, beds, baths, sqft, year_built, lot_size, condition, arv, as_is, asking_price, min_offer, max_offer, est_repairs, motivation, notes, stage, property_rating, script_answers, auction_date, auction_tier, lead_tags(tags(name))',
    )
    .eq('id', leadId)
    .single();
  if (leadError || !lead) throw new Error(leadError?.message ?? 'Lead not found.');

  const [inboundResult, outboundResult, callNoteResult] = await Promise.all([
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
    admin
      .from('lead_activities')
      .select('body, meta, created_at, type')
      .eq('lead_id', leadId)
      .in('type', ['call', 'note'])
      .order('created_at', { ascending: true }),
  ]);

  type Turn = { who: 'LEAD' | 'YOU'; body: string; at: string };
  const turns: Turn[] = [
    ...(inboundResult.data ?? []).map((m: any): Turn => ({
      who: 'LEAD',
      body: m.has_attachments ? `${m.body?.trim() ? `${m.body.trim()} ` : ''}[sent photo attachment(s)]` : m.body,
      at: m.received_at,
    })),
    ...(outboundResult.data ?? [])
      .filter((a: any) => a.meta?.direction === 'outbound')
      .map((a: any): Turn => ({ who: 'YOU', body: a.body ?? '', at: a.created_at })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const transcript = turns.map((t) => `${t.who}: ${t.body}`).join('\n');

  const callContext = (callNoteResult.data ?? [])
    .filter((a: any) => a.body?.trim())
    .map((a: any) => {
      const outcome = a.meta?.outcome as string | undefined;
      const label = a.type === 'call' ? `Call${outcome ? ` (outcome: ${outcome})` : ''}` : 'Note';
      const dateLabel = new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `[${label}, ${dateLabel}] ${a.body.trim()}`;
    })
    .join('\n');

  const scriptAnswers = (lead.script_answers ?? {}) as Record<string, unknown>;
  const scriptAnswersBlock = Object.entries(SCRIPT_ANSWER_LABELS)
    .map(([key, label]) => {
      const val = scriptAnswers[key];
      return typeof val === 'string' && val.trim() ? `- ${label}: ${val.trim()}` : null;
    })
    .filter((l): l is string => !!l)
    .join('\n');

  const tagNames: string[] = (lead.lead_tags ?? []).map((lt: any) => lt.tags?.name).filter(Boolean);

  const addressLine = [lead.address, [lead.city, lead.state].filter(Boolean).join(', '), lead.zip]
    .filter(Boolean)
    .join(', ');

  const propertyLines = [
    addressLine ? `Address: ${addressLine}` : null,
    lead.prop_type ? `Type: ${lead.prop_type}` : null,
    lead.beds || lead.baths ? `Beds/Baths: ${lead.beds ?? '?'} / ${lead.baths ?? '?'}` : null,
    lead.sqft ? `Sqft: ${lead.sqft}` : null,
    lead.year_built ? `Year built: ${lead.year_built}` : null,
    lead.lot_size ? `Lot size: ${lead.lot_size}` : null,
    lead.condition ? `Condition on file: ${lead.condition}` : null,
    money(lead.arv) ? `ARV: ${money(lead.arv)}` : null,
    money(lead.as_is) ? `As-is value: ${money(lead.as_is)}` : null,
    money(lead.asking_price) ? `Seller's asking price: ${money(lead.asking_price)}` : null,
    money(lead.est_repairs) ? `Estimated repairs: ${money(lead.est_repairs)}` : null,
    money(lead.min_offer) || money(lead.max_offer)
      ? `Our offer range: ${money(lead.min_offer) ?? '?'} - ${money(lead.max_offer) ?? '?'}`
      : null,
    lead.motivation ? `Motivation (on file): ${lead.motivation}` : null,
    lead.notes ? `Free-text notes: ${lead.notes}` : null,
    lead.property_rating ? `Caller's property rating: ${lead.property_rating}/10` : null,
    lead.auction_date ? `Auction date: ${lead.auction_date}${lead.auction_tier ? ` (tier: ${lead.auction_tier})` : ''}` : null,
    `Pipeline stage: ${lead.stage}`,
    tagNames.length ? `Tags: ${tagNames.join(', ')}` : null,
  ].filter((l): l is string => !!l);

  const userMessage = scoringUserMessage({
    propertyBlock: propertyLines.join('\n'),
    scriptAnswersBlock,
    callContext,
    transcript,
    hasTranscript: turns.length > 0,
  });

  const aiRes = await withTimeout(
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        system: SCORING_SYSTEM,
        messages: [{ role: 'user', content: userMessage }],
        tools: [
          {
            name: 'score_lead',
            description: 'Your acquisition-likelihood score and reasoning for this lead.',
            input_schema: {
              type: 'object',
              properties: {
                score: { type: 'integer', minimum: 0, maximum: 100, description: '0-100 acquisition likelihood score.' },
                reasoning: {
                  type: 'string',
                  description: '2-4 sentences, specific to this lead, citing what was actually said or is actually on file.',
                },
              },
              required: ['score', 'reasoning'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'score_lead' },
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }),
    `Claude scoring for ${leadId}`,
  );

  if (!aiRes.ok) throw new Error(`Anthropic error (${aiRes.status}): ${(await aiRes.text()).slice(0, 300)}`);

  const aiData = await aiRes.json();
  const toolUse = aiData.content?.find((b: { type: string }) => b.type === 'tool_use');
  const result = toolUse?.input as { score: number; reasoning: string } | undefined;
  if (!result || typeof result.score !== 'number' || !result.reasoning) {
    throw new Error('Model returned an unusable response.');
  }

  const score = Math.max(0, Math.min(100, Math.round(result.score)));
  const reasoning = result.reasoning.trim();

  const { error: updateError } = await admin
    .from('leads')
    .update({ ai_score: score, ai_score_reasoning: reasoning, ai_scored_at: new Date().toISOString() })
    .eq('id', leadId);
  if (updateError) throw new Error(`Failed to save score: ${updateError.message}`);

  return { score };
}

Deno.serve(async (req) => {
  if (!isAuthorizedCaller(req)) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const { data: leads, error } = await withTimeout(
      admin.from('leads').select('id').in('stage', SCORE_STAGES).limit(MAX_LEADS_PER_RUN),
      'leads lookup',
    );
    if (error) throw error;

    const leadIds = (leads ?? []).map((l: any) => l.id as string);
    let scored = 0;
    const failures: { leadId: string; error: string }[] = [];

    for (let i = 0; i < leadIds.length; i += CONCURRENCY) {
      const batch = leadIds.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (leadId) => {
          try {
            await scoreOneLead(admin, leadId);
            scored++;
          } catch (e) {
            failures.push({ leadId, error: e instanceof Error ? e.message : String(e) });
          }
        }),
      );
    }

    return json({ ok: true, eligible: leadIds.length, scored, failed: failures });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error.' }, 500);
  }
});
