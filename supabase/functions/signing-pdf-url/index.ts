// Edge Function: signing-pdf-url
//
// The blue-docs storage bucket is private, admin-only RLS, so an anonymous
// signer's browser can't call createSignedUrl itself (RLS would deny it).
// This is the one narrow hole: given a valid signing access_token, hand back
// a short-lived signed URL for that contract's own template PDF — nothing
// else in the bucket is reachable this way.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
      .select('contract_instance_id')
      .eq('access_token', token)
      .maybeSingle();
    if (partyErr) throw partyErr;
    if (!party) return json({ error: 'Not found' }, 404);

    const { data: instance, error: instErr } = await admin
      .from('contract_instances')
      .select('template_id, doc_templates(storage_path)')
      .eq('id', party.contract_instance_id)
      .single();
    if (instErr) throw instErr;
    const storagePath = (instance as any)?.doc_templates?.storage_path;
    if (!storagePath) return json({ error: 'No document on file' }, 404);

    const { data: signed, error: signErr } = await admin.storage.from('blue-docs').createSignedUrl(storagePath, 600);
    if (signErr) throw signErr;

    return json({ url: signed.signedUrl });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unexpected error' }, 500);
  }
});
