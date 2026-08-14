// Edge Function: record-consent
//
// Blue Docs overhaul, phase 2 — records a signer's affirmative agreement to
// sign electronically (ESIGN Act/UETA), before the signing UI itself ever
// appears. Same shape as log-signing-view (IP/user-agent read from the real
// request, not claimed by the client), but unlike that function this one
// isn't fire-and-forget — SignContractPage waits for it to succeed before
// moving past the consent screen, and submit-signature independently
// refuses to accept a signature with no matching 'consented' event on
// record, so the server never just trusts that the client showed the
// screen.
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

    const { data: party, error: partyErr } = await admin
      .from('contract_signing_parties')
      .select('id, contract_instance_id, contract_instances(status)')
      .eq('access_token', token)
      .maybeSingle();
    if (partyErr) throw partyErr;
    if (!party) return json({ error: 'Signing link not found' }, 404);

    const instanceStatus = (party as any).contract_instances?.status;
    if (['voided', 'declined'].includes(instanceStatus)) {
      return json({ error: 'This document is no longer available' }, 409);
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const userAgent = req.headers.get('user-agent');

    await admin.from('contract_audit_events').insert({
      contract_instance_id: party.contract_instance_id,
      party_id: party.id,
      event_type: 'consented',
      ip_address: ip,
      user_agent: userAgent,
    });

    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unexpected error' }, 500);
  }
});
