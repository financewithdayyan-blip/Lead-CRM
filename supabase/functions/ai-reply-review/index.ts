// Edge Function: ai-reply-review
//
// Runs once a night (pg_cron -> pg_net, see 0076_ai_reply_learned_rules.sql)
// against every lead the AI auto-replied to since the last run. For each
// conversation, asks Claude to judge whether ai-reply's own replies actually
// went wrong, and — only when it's confident the mistake reflects a real,
// repeatable gap in the prompt rather than a one-off — appends ONE new,
// narrow rule to ai_reply_learned_rules for ai-reply to pick up on its next
// invocation (see the LEARNED_CASES block in ai-reply/index.ts).
//
// Deliberately never touches ai-reply/index.ts itself. The hand-authored
// SYSTEM_RULES there — especially "never state or confirm a price" and the
// opt-out/STOP handling — are not reachable from this function at all; the
// only thing this can ever do is INSERT an additive row into a separate
// table. That's the whole safety design: worst case is a redundant or
// slightly-off learned rule, never a corrupted core prompt.
//
// Not surfaced anywhere in the CRM UI by design — this runs quietly. Each
// run still writes one row to ai_reply_review_log so a past run can be
// inspected later if the AI's behavior on some lead ever needs explaining.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.101.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
// A purpose-made secret, not SUPABASE_SERVICE_ROLE_KEY — deployed edge
// functions resolve that env var to Supabase's newer sb_secret_... key
// format, while the pg_cron job's own Vault-stored copy (set once, long
// before the rotation) is still the legacy JWT-format key. Comparing
// against SERVICE_ROLE_KEY here would silently 401 every single nightly run
// forever, with nothing to ever surface that failure since it happens
// before this function writes anything to ai_reply_review_log at all.
const CRON_SECRET = Deno.env.get('AI_REVIEW_CRON_SECRET')!;

// Called by pg_cron via pg_net, never by a user.
function isAuthorizedCaller(req: Request): boolean {
  return req.headers.get('x-internal-secret') === CRON_SECRET;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const FETCH_TIMEOUT_MS = 30_000;
function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timed out waiting on ${label}`)), FETCH_TIMEOUT_MS)),
  ]);
}

// Caps how much one run can ever do, regardless of how much volume piled up
// — keeps this comfortably inside the edge runtime's execution limit, and
// keeps a single bad batch from flooding the prompt with many new rules at
// once (a real risk for a process nobody is watching day to day).
const MAX_LEADS_PER_RUN = 25;
const MAX_NEW_RULES_PER_RUN = 3;
const CONCURRENCY = 3;

const REVIEWER_GUARDRAILS = `You are auditing SMS conversations that another AI (texting on behalf of Bluebird Acquisition, a real-estate cash-offer acquisitions company) had with real sellers. Your job is only to catch REAL, REPEATABLE mistakes in how that AI handled a conversation — not to nitpick style or phrasing.

HARD RULES — never violate these regardless of what you see in a conversation:
- Never propose a rule that changes, weakens, loosens, or contradicts the AI's refusal to state, confirm, or imply any specific dollar figure as a price or offer. That refusal is correct even when it reads as evasive or frustrates the seller — it is a firm business rule, not a mistake.
- Never propose a rule about opt-out, STOP, or compliance handling.
- Never propose a rule that reorders, skips, or jumps ahead of the qualification framework's fixed step order: CONDITION, then PRICE, then TIMELINE, then MORTGAGE (foreclosure/lis pendens/pre-foreclosure/auction leads only), then PHOTOS, then CALLBACK. That order is a deliberate business decision, not a mistake to fix — asking out of order is exactly the kind of thing this framework exists to prevent, even if a specific conversation seems like it would have flowed better with a different order.
- Only propose a new rule when the mistake is a genuine, repeatable GAP in the existing rules (something no current rule covers), not a one-off slip the model would likely get right next time anyway.
- If the mistake is already covered by an existing rule below and the AI just failed to apply it correctly, that's a one-off — do not propose a duplicate or rephrased version of a rule that already exists.
- A proposed rule must be a single, narrow, concrete SPECIAL CASE — written the same terse style as the examples below — not a restatement of general advice, and it must never contradict or override the framework's step order above.`;

Deno.serve(async (req) => {
  if (!isAuthorizedCaller(req)) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const detail: Array<{ leadId: string; mistakeSummary?: string; ruleAdded: boolean }> = [];
  let conversationsReviewed = 0;
  let issuesFound = 0;
  let rulesAdded = 0;

  try {
    // Checked first, before anything else — including the "last run"
    // lookup below — so turning this off in Settings genuinely stops every
    // bit of Opus 5 spend rather than just hiding a report. Any row with
    // enabled=false skips the run entirely; no row at all defaults to
    // enabled, matching the toggle's own default in useAiReviewSettings.
    const { data: settingsRows } = await withTimeout(
      admin.from('ai_reply_review_settings').select('enabled').abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
      'review settings lookup',
    );
    if (settingsRows?.some((r) => r.enabled === false)) {
      return json({ ok: true, skipped: true, reason: 'disabled in settings' });
    }

    const { data: lastRun } = await withTimeout(
      admin.from('ai_reply_review_log').select('run_at').order('run_at', { ascending: false }).limit(1)
        .maybeSingle().abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
      'last run lookup',
    );
    // First run ever: look back 24h rather than the whole table's history.
    const since = lastRun?.run_at ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: recentAi } = await withTimeout(
      admin.from('lead_activities').select('lead_id').eq('type', 'sms').eq('meta->>aiGenerated', 'true')
        .gte('created_at', since).abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
      'recent AI activity lookup',
    );
    const leadIds = [...new Set((recentAi ?? []).map((r) => r.lead_id as string))].slice(0, MAX_LEADS_PER_RUN);

    const { data: existingRules } = await withTimeout(
      admin.from('ai_reply_learned_rules').select('rule_text').eq('active', true)
        .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
      'existing rules lookup',
    );
    const existingRulesBlock = existingRules?.length
      ? existingRules.map((r) => `- ${r.rule_text}`).join('\n')
      : '(none yet)';

    async function reviewLead(leadId: string) {
      conversationsReviewed++;
      try {
        const { data: activities } = await withTimeout(
          admin.from('lead_activities').select('body, meta, created_at').eq('lead_id', leadId).eq('type', 'sms')
            .order('created_at', { ascending: true }).abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
          `activities for ${leadId}`,
        );
        const turns = (activities ?? [])
          .filter((a) => a.body?.trim())
          .map((a) => `${(a.meta as { direction?: string })?.direction === 'inbound' ? 'LEAD' : 'YOU'}: ${a.body}`);
        if (turns.length < 2) return;
        const transcript = turns.join('\n');

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
              system: REVIEWER_GUARDRAILS,
              messages: [
                {
                  role: 'user',
                  content: `EXISTING RULES already in the AI's prompt (do not propose anything that duplicates or restates one of these):\n${existingRulesBlock}\n\nCONVERSATION TO AUDIT:\n${transcript}\n\nDid the AI (the "YOU" side) make a real mistake anywhere in this conversation? Call review_conversation with your judgment.`,
                },
              ],
              tools: [
                {
                  name: 'review_conversation',
                  description: 'Your audit judgment on this conversation.',
                  input_schema: {
                    type: 'object',
                    properties: {
                      has_mistake: { type: 'boolean', description: 'True only if the AI genuinely got something wrong.' },
                      mistake_summary: { type: 'string', description: 'One or two sentences on what went wrong, empty string if has_mistake is false.' },
                      confidence: { type: 'string', enum: ['low', 'medium', 'high'], description: 'How confident you are this is a real, repeatable prompt gap worth fixing, not a one-off.' },
                      proposed_rule: {
                        type: 'string',
                        description: 'A new SPECIAL CASE rule, written in the same terse imperative style as the existing rules, that would have prevented this specific mistake. Empty string if has_mistake is false, confidence is not high, or this is already covered by an existing rule.',
                      },
                    },
                    required: ['has_mistake', 'mistake_summary', 'confidence', 'proposed_rule'],
                  },
                },
              ],
              tool_choice: { type: 'tool', name: 'review_conversation' },
            }),
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          }),
          `Claude review for ${leadId}`,
        );
        if (!aiRes.ok) throw new Error(`Claude API failed (${aiRes.status}): ${await aiRes.text()}`);
        const aiData = await aiRes.json();
        const toolUse = aiData.content?.find((b: { type: string }) => b.type === 'tool_use');
        const result = toolUse?.input as
          | { has_mistake: boolean; mistake_summary: string; confidence: string; proposed_rule: string }
          | undefined;
        if (!result?.has_mistake) return;

        issuesFound++;
        const shouldAddRule =
          result.confidence === 'high' && result.proposed_rule?.trim() && rulesAdded < MAX_NEW_RULES_PER_RUN;

        if (shouldAddRule) {
          await withTimeout(
            admin.from('ai_reply_learned_rules').insert({
              rule_text: result.proposed_rule.trim(),
              source_lead_id: leadId,
              reasoning: result.mistake_summary,
            }).abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
            `inserting rule for ${leadId}`,
          );
          rulesAdded++;
        }
        detail.push({ leadId, mistakeSummary: result.mistake_summary, ruleAdded: !!shouldAddRule });
      } catch (e) {
        detail.push({ leadId, mistakeSummary: `review error: ${e instanceof Error ? e.message : String(e)}`, ruleAdded: false });
      }
    }

    for (let i = 0; i < leadIds.length; i += CONCURRENCY) {
      await Promise.all(leadIds.slice(i, i + CONCURRENCY).map(reviewLead));
    }

    await admin.from('ai_reply_review_log').insert({
      conversations_reviewed: conversationsReviewed,
      issues_found: issuesFound,
      rules_added: rulesAdded,
      detail,
    });

    return json({ ok: true, conversationsReviewed, issuesFound, rulesAdded });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await admin.from('ai_reply_review_log').insert({
      conversations_reviewed: conversationsReviewed,
      issues_found: issuesFound,
      rules_added: rulesAdded,
      detail,
      error: message,
    }).catch(() => {});
    return json({ error: message }, 500);
  }
});
