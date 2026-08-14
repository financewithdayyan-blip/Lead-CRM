// Edge Function: decline-signature
//
// Blue Docs overhaul, phase 1d — public/unauthenticated, same token-in-body
// posture as submit-signature. A signer who can't or won't sign uses this
// instead of just abandoning the page, so the admin finds out and the chain
// stops cleanly rather than sitting silently "waiting on" someone forever.
// Since signing is strictly sequential, one decline ends the whole contract
// — there's no "skip this party" concept.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const { token, reason } = await req.json();
    if (!token) return json({ error: 'Missing token' }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: party, error: partyErr } = await admin
      .from('contract_signing_parties')
      .select('*, contract_instances(status, name)')
      .eq('access_token', token)
      .maybeSingle();
    if (partyErr) throw partyErr;
    if (!party) return json({ error: 'Signing link not found' }, 404);
    if (party.status === 'signed') return json({ error: 'This has already been signed' }, 409);

    const instanceStatus = (party as any).contract_instances?.status;
    if (['voided', 'declined'].includes(instanceStatus)) {
      return json({ error: 'This document is no longer available' }, 409);
    }

    const declinedAt = new Date().toISOString();
    const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const userAgent = req.headers.get('user-agent');

    const { error: updateErr } = await admin
      .from('contract_signing_parties')
      .update({ status: 'declined', declined_at: declinedAt, declined_reason: reason ?? null })
      .eq('id', party.id);
    if (updateErr) throw updateErr;

    await admin.from('contract_audit_events').insert({
      contract_instance_id: party.contract_instance_id,
      party_id: party.id,
      event_type: 'declined',
      ip_address: ipAddress,
      user_agent: userAgent,
    });

    // Sequential signing means a decline anywhere halts the whole contract,
    // not just this one party's step.
    await admin.from('contract_instances').update({ status: 'declined' }).eq('id', party.contract_instance_id);

    const { data: admins } = await admin.from('profiles').select('id').eq('role', 'admin');
    if (admins?.length) {
      const docName = (party as any).contract_instances?.name ?? 'a document';
      await admin.from('lc_notifications').insert(
        admins.map((a) => ({
          user_id: a.id,
          type: 'contract_declined',
          title: 'A signer declined to sign',
          body: `${party.name} declined to sign ${docName}${reason ? `: "${reason}"` : '.'}`,
        })),
      );
    }

    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unexpected error' }, 500);
  }
});
