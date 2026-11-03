// Edge Function: submit-capture-photo
//
// Receives one photo at a time from the public guided-capture page
// (CapturePage, /capture/:token). Public and unauthenticated by necessity —
// the seller's browser has no CRM login — so the token itself is the only
// credential, resolved server-side against photo_capture_sessions rather
// than trusted from the client. Lands in the exact same lead-files bucket
// and lead_files table every other lead photo uses (manual upload, MMS
// re-host), so it shows up in the Property tab gallery with no separate
// review step.
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

function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const form = await req.formData();
    const token = form.get('token');
    const category = form.get('category');
    const image = form.get('image');
    if (typeof token !== 'string' || typeof category !== 'string' || !(image instanceof File)) {
      return json({ error: 'Missing token, category, or image' }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: session, error: sessionErr } = await admin
      .from('photo_capture_sessions')
      .select('id, lead_id, status, photos_count, leads(user_id)')
      .eq('token', token)
      .maybeSingle();
    if (sessionErr) throw sessionErr;
    if (!session) return json({ error: 'Capture link not found' }, 404);
    if (session.status === 'completed') return json({ error: 'This capture link has already been completed' }, 409);

    const leadUserId = (session as any).leads?.user_id;
    if (!leadUserId) return json({ error: 'Lead not found' }, 404);

    const bytes = new Uint8Array(await image.arrayBuffer());
    const path = `${session.lead_id}/capture-${slugify(category)}-${Date.now()}.jpg`;

    const { error: uploadErr } = await admin.storage.from('lead-files').upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
    if (uploadErr) throw uploadErr;

    const { error: insertErr } = await admin
      .from('lead_files')
      .insert({ lead_id: session.lead_id, user_id: leadUserId, storage_path: path, file_name: `${category}.jpg`, file_type: 'image/jpeg' });
    if (insertErr) throw insertErr;

    const { error: updateErr } = await admin
      .from('photo_capture_sessions')
      .update({ status: 'in_progress', photos_count: session.photos_count + 1 })
      .eq('id', session.id);
    if (updateErr) throw updateErr;

    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unexpected error' }, 500);
  }
});
