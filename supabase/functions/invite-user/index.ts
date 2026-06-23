// Edge Function: invite-user
//
// Sends a real Supabase invite email to a prospective team member. Runs
// server-side so the service_role key never reaches the browser.
//
// Flow:
//   1. Verify the caller is signed in and has role = 'admin' (using a client
//      scoped to the caller's own JWT, so this is enforced by RLS too, not
//      just this check).
//   2. Record/refresh a pending row in public.team_invites as the caller -
//      this must happen BEFORE inviteUserByEmail, because that call inserts
//      into auth.users immediately, which fires the existing
//      handle_new_user() trigger that looks up team_invites to assign the
//      role and team_members link right then.
//   3. Use a service_role client (admin API) to actually send the invite
//      email via supabase.auth.admin.inviteUserByEmail().
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header.' }, 401);

    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'Not authenticated.' }, 401);
    const caller = userData.user;

    const { data: callerProfile, error: profileError } = await callerClient
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .single();
    if (profileError || callerProfile?.role !== 'admin') {
      return json({ error: 'Only admins can invite team members.' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const role = body.role === 'admin' ? 'admin' : 'caller';
    const redirectTo = typeof body.redirectTo === 'string' && body.redirectTo ? body.redirectTo : undefined;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'A valid email is required.' }, 400);
    }
    if (email === caller.email?.toLowerCase()) {
      return json({ error: "That's your own email." }, 400);
    }

    const { data: existing } = await callerClient
      .from('team_invites')
      .select('id')
      .eq('owner_id', caller.id)
      .ilike('email', email)
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) {
      const { error: updateError } = await callerClient.from('team_invites').update({ role }).eq('id', existing.id);
      if (updateError) return json({ error: `Could not update invite: ${updateError.message}` }, 400);
    } else {
      const { error: insertError } = await callerClient
        .from('team_invites')
        .insert({ owner_id: caller.id, email, role, status: 'pending' });
      if (insertError) return json({ error: `Could not record invite: ${insertError.message}` }, 400);
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { error: sendError } = await adminClient.auth.admin.inviteUserByEmail(email, redirectTo ? { redirectTo } : undefined);
    if (sendError) {
      // Don't leave a pending row with no email actually sent for a brand-new invite.
      if (!existing) {
        await callerClient.from('team_invites').update({ status: 'revoked' }).eq('owner_id', caller.id).ilike('email', email);
      }
      return json({ error: `Could not send invite email: ${sendError.message}` }, 400);
    }

    return json({ ok: true });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error.' }, 500);
  }
});
