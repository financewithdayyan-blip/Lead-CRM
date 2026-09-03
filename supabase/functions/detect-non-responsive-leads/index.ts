// Edge Function: detect-non-responsive-leads
//
// Daily sweep that moves a lead to the Non Responsive stage the moment its
// last outbound text has sat unanswered 20+ days — see migration 0135 and
// src/types/domain.ts's STAGE_CONFIG comment for the full reasoning. Only
// moves the card so it's easy to find; sends nothing itself. The actual
// "try a different number" move stays a deliberate human click via
// SmsThreadTab's "Switch number" control.
//
// Source stages are contacted/replied/initial_contact/followup only —
// negotiation/contract/in_title/closed are too committed to silently move
// off their own board, and onhold already has its own nurture cron
// (send-onhold-followups) and pinning rule. A reply from a Non Responsive
// lead promotes it straight back to 'replied' (sms-webhook's ADVANCE_FROM)
// rather than staying pinned like On Hold — this stage is meant to be
// temporary, the opposite of On Hold's deliberate-pause semantics.
//
// Called only by pg_cron. Auth is a purpose-made secret compared via
// x-internal-secret, not the service-role-key pattern — see
// send-onhold-followups' own note on why that pattern silently 401s.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DISPATCH_SECRET = Deno.env.get('NON_RESPONSIVE_CRON_SECRET')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const SOURCE_STAGES = ['contacted', 'replied', 'initial_contact', 'followup'];
const SILENCE_DAYS = 20;
// No external API calls here (pure DB reads), so this can comfortably cover
// the whole eligible pool in one run rather than needing a leftover-picks-up-
// next-time cap like the AI-calling sweeps (score-lead, send-onhold-followups).
const MAX_LEADS_PER_RUN = 1000;
const CONCURRENCY = 10;

async function isNonResponsive(admin: ReturnType<typeof createClient>, leadId: string): Promise<boolean> {
  const [{ data: lastInbound }, { data: lastOutbound }] = await Promise.all([
    admin
      .from('inbound_messages')
      .select('received_at')
      .eq('lead_id', leadId)
      .eq('is_reaction', false)
      .order('received_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from('lead_activities')
      .select('created_at')
      .eq('lead_id', leadId)
      .eq('type', 'sms')
      .contains('meta', { direction: 'outbound' })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!lastOutbound?.created_at) return false; // never texted at all — nothing to judge silence against
  const outboundAt = new Date(lastOutbound.created_at).getTime();
  const inboundAt = lastInbound?.received_at ? new Date(lastInbound.received_at).getTime() : null;
  // The ball has to actually be in their court — if they replied more
  // recently than our last text, they're not the ones going quiet.
  if (inboundAt !== null && inboundAt >= outboundAt) return false;
  const daysSince = (Date.now() - outboundAt) / (1000 * 60 * 60 * 24);
  return daysSince >= SILENCE_DAYS;
}

Deno.serve(async (req) => {
  if (req.headers.get('x-internal-secret') !== DISPATCH_SECRET) return json({ error: 'Unauthorized.' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const { data: leads, error } = await admin
      .from('leads')
      .select('id')
      .in('stage', SOURCE_STAGES)
      .limit(MAX_LEADS_PER_RUN);
    if (error) throw error;

    const leadIds = (leads ?? []).map((l: any) => l.id as string);
    const flagged: string[] = [];

    for (let i = 0; i < leadIds.length; i += CONCURRENCY) {
      const batch = leadIds.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (leadId) => {
          if (await isNonResponsive(admin, leadId)) flagged.push(leadId);
        }),
      );
    }

    if (flagged.length > 0) {
      const { error: updateError } = await admin.from('leads').update({ stage: 'non_responsive' }).in('id', flagged);
      if (updateError) throw updateError;
    }

    return json({ ok: true, eligible: leadIds.length, flagged: flagged.length, leadIds: flagged });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error.' }, 500);
  }
});
