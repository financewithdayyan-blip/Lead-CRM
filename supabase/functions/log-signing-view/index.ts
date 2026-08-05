// Edge Function: log-signing-view
//
// Fired once by a signer's own page on load, regardless of whether it's
// actually their turn yet — "did they open the link at all" belongs on the
// audit trail independent of when they got around to signing. Runs as an
// edge function rather than a plain RPC specifically so the IP/user-agent
// are read from the real request, not something the client claims.
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
    const { token } = await req.json();
    if (!token) return json({ error: 'Missing token' }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: party } = await admin
      .from('contract_signing_parties')
      .select('id, contract_instance_id')
      .eq('access_token', token)
      .maybeSingle();
    if (!party) return json({ ok: true }); // invalid token — nothing to log, still 200 so the page doesn't surface an error

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const userAgent = req.headers.get('user-agent');

    await admin.from('contract_audit_events').insert({
      contract_instance_id: party.contract_instance_id,
      party_id: party.id,
      event_type: 'viewed',
      ip_address: ip,
      user_agent: userAgent,
    });

    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unexpected error' }, 500);
  }
});
