// Edge Function: update-contract-instance
//
// Lets an admin correct a contract's terms (deal numbers, special
// provisions, a party's contact info) after it's already been sent, without
// voiding and starting over — but only while it's still safe to do so.
// Mirrors create-contract-instance's validation, but updates the existing
// instance/party rows in place instead of inserting fresh ones, and never
// re-sends an invite (existing signing links/tokens are untouched, so
// nobody who was already notified needs a new message — only a brand new
// party, added during this edit, has no link yet).
//
// Hard server-side gate, not just a client-side one: rejected once the
// instance is anything but 'sent', or once ANY party has actually signed —
// editing what someone already signed would make their signature apply to
// different terms than the ones they saw, which is a real legal problem,
// not just a UI inconvenience. See the Amendment Contract template for how
// to correct an already-signed contract instead.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

const FETCH_TIMEOUT_MS = 15_000;
function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timed out waiting on ${label}`)), FETCH_TIMEOUT_MS)),
  ]);
}

interface PartyInput {
  role: string;
  name: string;
  phone: string;
  email?: string;
  sendSms: boolean;
  sendEmail: boolean;
  signOrder: number;
}

function toE164(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

function isValidEmail(raw: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw.trim());
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });

    const { data: userData } = await withTimeout(callerClient.auth.getUser(), 'auth.getUser()');
    const userId = userData?.user?.id;
    if (!userId) return json({ error: 'Not signed in.' }, 401);

    const { data: profile } = await withTimeout(
      admin.from('profiles').select('role').eq('id', userId).single(),
      'profile lookup',
    );
    if (profile?.role !== 'admin') return json({ error: 'Admins only.' }, 403);

    const body = await req.json();
    const { instanceId, name, propertyAddress, fieldValues, parties } = body as {
      instanceId: string;
      name?: string;
      propertyAddress?: string;
      fieldValues: Record<string, string>;
      parties: PartyInput[];
    };
    if (!instanceId || !propertyAddress?.trim() || !parties?.length) {
      return json({ error: 'Missing required fields.' }, 400);
    }

    const { data: instance, error: instErr } = await withTimeout(
      admin.from('contract_instances').select('id, status, name').eq('id', instanceId).single(),
      'instance lookup',
    );
    if (instErr || !instance) return json({ error: 'Contract not found.' }, 404);
    if (instance.status !== 'sent') {
      return json({ error: 'This contract can no longer be edited — it has been completed, voided, or declined.' }, 409);
    }

    const { data: existingParties, error: partiesErr } = await withTimeout(
      admin.from('contract_signing_parties').select('id, role, status').eq('contract_instance_id', instanceId),
      'parties lookup',
    );
    if (partiesErr) throw partiesErr;
    if ((existingParties ?? []).some((p) => p.status === 'signed')) {
      return json({ error: 'Someone has already signed this contract — it can no longer be edited.' }, 409);
    }

    const normalizedParties: (PartyInput & { e164: string | null; emailNormalized: string | null })[] = [];
    for (const p of parties) {
      if (!p.sendSms && !p.sendEmail) return json({ error: `"${p.name}" needs at least one delivery method selected.` }, 400);
      let e164: string | null = null;
      if (p.sendSms) {
        e164 = toE164(p.phone ?? '');
        if (!e164) return json({ error: `"${p.name}" needs a valid phone number to send by SMS.` }, 400);
      }
      let emailNormalized: string | null = null;
      if (p.sendEmail) {
        const trimmed = (p.email ?? '').trim();
        if (!isValidEmail(trimmed)) return json({ error: `"${p.name}" needs a valid email address to send by email.` }, 400);
        emailNormalized = trimmed;
      }
      normalizedParties.push({ ...p, e164, emailNormalized });
    }

    const existingByRole = new Map((existingParties ?? []).map((p) => [p.role, p]));
    const incomingRoles = new Set(normalizedParties.map((p) => p.role));

    // Roles that used to have a party but no longer do (e.g. a co-seller
    // removed during this edit) — safe to drop outright, the guard above
    // already confirmed nobody on this contract has signed anything.
    const rolesToRemove = [...existingByRole.keys()].filter((role) => !incomingRoles.has(role));
    if (rolesToRemove.length > 0) {
      const idsToRemove = rolesToRemove.map((role) => existingByRole.get(role)!.id);
      const { error: deleteErr } = await admin.from('contract_signing_parties').delete().in('id', idsToRemove);
      if (deleteErr) throw deleteErr;
    }

    for (const p of normalizedParties) {
      const existing = existingByRole.get(p.role);
      if (existing) {
        const { error: updateErr } = await admin
          .from('contract_signing_parties')
          .update({
            name: p.name,
            phone: p.e164,
            email: p.emailNormalized,
            send_sms: p.sendSms,
            send_email: p.sendEmail,
            sign_order: p.signOrder,
          })
          .eq('id', existing.id);
        if (updateErr) throw updateErr;
      } else {
        // A brand new role added during this edit (e.g. a co-seller who
        // wasn't on the original send) — has no signing link yet at all,
        // so unlike every other party here it does still need one, on
        // whatever the next actual send/reminder touches it.
        const { error: insertErr } = await admin.from('contract_signing_parties').insert({
          contract_instance_id: instanceId,
          role: p.role,
          name: p.name,
          phone: p.e164,
          email: p.emailNormalized,
          send_sms: p.sendSms,
          send_email: p.sendEmail,
          sign_order: p.signOrder,
        });
        if (insertErr) throw insertErr;
      }
    }

    const { error: updateInstanceErr } = await admin
      .from('contract_instances')
      .update({
        name: name ?? instance.name,
        property_address: propertyAddress.trim(),
        field_values: fieldValues ?? {},
      })
      .eq('id', instanceId);
    if (updateInstanceErr) throw updateInstanceErr;

    await admin.from('contract_audit_events').insert({
      contract_instance_id: instanceId,
      party_id: null,
      event_type: 'edited',
    });

    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unexpected error' }, 500);
  }
});
