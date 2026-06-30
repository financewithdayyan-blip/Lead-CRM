// Edge Function: score-lead
//
// Scores a real-estate lead from 0-100 using a deterministic rubric that
// reads all available lead data + call history. No external AI API required.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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

// ── Scoring rubric ─────────────────────────────────────────────────────────
// 5 dimensions, each worth up to a set number of points, totalling 100.

function scoreLead(lead: any, activities: any[]): { score: number; reasoning: string } {
  const positives: string[] = [];
  const negatives: string[] = [];
  let total = 0;

  // 1. STAGE MOMENTUM  (max 20 pts)
  const stagePoints: Record<string, number> = {
    dead_declined: 0,
    new:           8,
    voicemail:     10,
    onhold:        12,
    initial_contact: 16,
    followup:      18,
    negotiation:   20,
    contract:      20,
  };
  const stagePts = stagePoints[lead.stage] ?? 8;
  total += stagePts;
  if (lead.stage === 'dead_declined') {
    negatives.push('marked dead/declined');
  } else if (['negotiation', 'contract', 'followup'].includes(lead.stage)) {
    positives.push(`advanced to ${lead.stage.replace('_', ' ')} stage`);
  }

  // 2. FINANCIAL ALIGNMENT  (max 25 pts)
  // How well does the asking price align with our offer range?
  if (lead.arv && lead.asking_price && lead.arv > 0) {
    const ratio = lead.asking_price / lead.arv;
    if (ratio <= 0.50)       { total += 25; positives.push('asking price ≤50% of ARV — excellent margin'); }
    else if (ratio <= 0.65)  { total += 20; positives.push('asking price well below ARV'); }
    else if (ratio <= 0.75)  { total += 14; }
    else if (ratio <= 0.85)  { total += 7;  }
    else if (ratio <= 0.95)  { total += 3;  negatives.push('asking price close to ARV — thin margin'); }
    else                     { total += 0;  negatives.push('asking price at or above ARV'); }
  } else if (lead.arv || lead.asking_price) {
    total += 6; // partial financial data
  } else if (lead.min_offer || lead.max_offer) {
    total += 4;
  }

  // 3. SELLER MOTIVATION  (max 25 pts)
  const motivationText = [
    lead.motivation,
    lead.script_answers?.motivation,
    lead.notes,
  ].filter(Boolean).join(' ').toLowerCase();

  const urgentKeywords = ['urgent', 'asap', 'must sell', 'foreclos', 'divorce', 'bankruptcy', 'behind on', 'evict', 'relocat'];
  const sellKeywords = ['want to sell', 'looking to sell', 'ready', 'motivated', 'need to sell', 'move'];

  const timeline = (lead.script_answers?.timeline ?? '').toLowerCase();
  const shortTimeline = /(\d+)\s*(week|month)/.test(timeline) ||
    timeline.includes('asap') || timeline.includes('soon') || timeline.includes('immediately');

  if (urgentKeywords.some(k => motivationText.includes(k))) {
    total += 25; positives.push('seller shows high urgency or distress');
  } else if (sellKeywords.some(k => motivationText.includes(k))) {
    total += 16; positives.push('clear seller motivation');
  } else if (motivationText.length > 10) {
    total += 8;
  }

  if (shortTimeline) { total += 5; positives.push('short timeline to close'); }

  // 4. CALL ENGAGEMENT  (max 15 pts)
  const calls = activities.filter((a: any) => a.type === 'call');
  const qualityOutcomes = calls.filter((a: any) =>
    ['initial_contact', 'followup', 'negotiation', 'contract'].includes(a.meta?.outcome)
  );
  if (qualityOutcomes.length >= 3)     { total += 15; positives.push('3+ quality conversations'); }
  else if (qualityOutcomes.length >= 2) { total += 12; positives.push('multiple quality conversations'); }
  else if (qualityOutcomes.length === 1){ total += 8;  positives.push('reached seller at least once'); }
  else if (calls.length >= 3)           { total += 4; }
  else if (calls.length > 0)            { total += 2; }
  else                                  { negatives.push('no call activity yet'); }

  // 5. PROFILE COMPLETENESS + CALLER RATING  (max 15 pts)
  let completeness = 0;
  if (lead.address)         completeness += 2;
  if (lead.prop_type)       completeness += 1;
  if (lead.condition)       completeness += 2;
  if (lead.arv)             completeness += 2;
  if (lead.beds && lead.baths) completeness += 1;
  if (lead.script_answers?.motivation) completeness += 1;
  if (lead.script_answers?.price)      completeness += 1;
  if (lead.script_answers?.timeline)   completeness += 1;
  total += Math.min(10, completeness);

  if (lead.rating && lead.rating >= 1) {
    // rating 1-10 → up to 5 pts
    total += Math.round((lead.rating / 10) * 5);
    if (lead.rating >= 8) positives.push(`caller rated this lead ${lead.rating}/10`);
  }

  // Cap
  const score = Math.max(0, Math.min(100, Math.round(total)));

  // Build reasoning sentence
  let reasoning: string;
  if (lead.stage === 'dead_declined') {
    reasoning = 'Lead is marked as dead or declined. Score reflects no acquisition potential at this time.';
  } else if (score >= 80) {
    const top = positives.slice(0, 2).join(' and ');
    reasoning = `High-priority acquisition candidate. ${top ? top.charAt(0).toUpperCase() + top.slice(1) + '.' : ''} Recommend moving quickly before seller talks to other buyers.`;
  } else if (score >= 60) {
    const top = positives[0] ?? 'some positive indicators';
    const neg = negatives[0];
    reasoning = `Solid prospect with ${top}${neg ? `, though ${neg}` : ''}. Continue follow-up to confirm motivation and tighten numbers.`;
  } else if (score >= 40) {
    const neg = negatives[0] ?? 'limited data available';
    reasoning = `Moderate lead — ${neg}. Gather more info on motivation, timeline, and price expectations before committing resources.`;
  } else {
    const neg = negatives.slice(0, 2).join(' and ') || 'insufficient information';
    reasoning = `Low conversion probability. Key issues: ${neg}. Re-qualify or move to dead pipeline unless situation changes.`;
  }

  return { score, reasoning };
}

// ── Handler ────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header.' }, 401);

    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'Not authenticated.' }, 401);

    const body = await req.json().catch(() => ({}));
    const leadId = typeof body.lead_id === 'string' ? body.lead_id.trim() : '';
    if (!leadId) return json({ error: 'lead_id is required.' }, 400);

    const [leadResult, activitiesResult] = await Promise.all([
      callerClient.from('leads').select('*').eq('id', leadId).single(),
      callerClient
        .from('lead_activities')
        .select('type, meta, created_at')
        .eq('lead_id', leadId)
        .limit(50),
    ]);

    if (leadResult.error || !leadResult.data) {
      return json({ error: 'Lead not found or access denied.' }, 404);
    }

    const { score, reasoning } = scoreLead(leadResult.data, activitiesResult.data ?? []);

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { error: updateError } = await adminClient
      .from('leads')
      .update({ ai_score: score, ai_score_reasoning: reasoning, ai_scored_at: new Date().toISOString() })
      .eq('id', leadId);

    if (updateError) return json({ error: `Failed to save score: ${updateError.message}` }, 500);

    return json({ score, reasoning });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error.' }, 500);
  }
});
