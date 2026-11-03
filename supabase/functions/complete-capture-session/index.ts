// Edge Function: complete-capture-session
//
// Called once, when the seller finishes (or explicitly ends) the guided
// photo capture flow. Public/unauthenticated like submit-capture-photo —
// same token-as-credential model. Marks the session done and drops a
// notification for the agent who owns the lead (lc_notifications — the
// same table the bell icon already reads), so they find out the photos are
// in without having to go check.
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

    const { data: session, error: sessionErr } = await admin
      .from('photo_capture_sessions')
      .select('id, lead_id, photos_count, leads(user_id, first_name, last_name)')
      .eq('token', token)
      .maybeSingle();
    if (sessionErr) throw sessionErr;
    if (!session) return json({ error: 'Capture link not found' }, 404);

    const { error: updateErr } = await admin
      .from('photo_capture_sessions')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', session.id);
    if (updateErr) throw updateErr;

    const lead = (session as any).leads;
    if (lead?.user_id) {
      const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'A seller';
      await admin.from('lc_notifications').insert({
        user_id: lead.user_id,
        lead_id: session.lead_id,
        type: 'photo_capture_completed',
        title: 'Photos received',
        body: `${name} finished the guided photo capture — ${session.photos_count} photo${session.photos_count === 1 ? '' : 's'} uploaded.`,
      });
    }

    return json({ ok: true, photosCount: session.photos_count });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unexpected error' }, 500);
  }
});
