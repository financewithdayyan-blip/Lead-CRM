// Edge Function: create-contract-instance
//
// Blue Docs overhaul, phase 1a — replaces the client-side two-insert flow
// that used to live in useGenerateContract (src/hooks/useContractInstances.ts).
// Moving this server-side makes the whole "create the contract, send the
// first invite" sequence one atomic request: there is no longer a window
// where the DB rows exist but the invite SMS was never attempted because the
// admin's tab closed between two separate client-driven steps.
//
// Admin-only, real logged-in session — same posture and auth pattern as
// send-sms (caller-scoped client for auth.getUser(), then the service-role
// client for everything else).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const ZOOM_ACCOUNT_ID = Deno.env.get('ZOOM_ACCOUNT_ID')!;
const ZOOM_CLIENT_ID = Deno.env.get('ZOOM_CLIENT_ID')!;
const ZOOM_CLIENT_SECRET = Deno.env.get('ZOOM_CLIENT_SECRET')!;

// Blue Docs sends from one dedicated number, never the round-robin pool
// send-sms/bulk-sms-dispatcher use for cold outreach — every signer's
// replies land in one predictable thread, and sms-webhook only needs to
// guard this one number against createLeadFromUnmatched (see that
// function's own updated comment).
const BLUEDOCS_NUMBER = {
  phone: Deno.env.get('ZOOM_FROM_NUMBER_BLUEDOCS') ?? '',
  email: Deno.env.get('ZOOM_USER_EMAIL_BLUEDOCS') ?? '',
  label: Deno.env.get('ZOOM_LABEL_BLUEDOCS') ?? 'Blue Docs',
};

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

// ── Zoom sending (duplicated from send-sms, not shared — this codebase's
// own established convention, see sms-backfill/bulk-sms-dispatcher). ───────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let cachedToken: { token: string; expiresAt: number } | null = null;

async function zoomFetch(url: string, options: RequestInit, maxRetries = 4): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), ...options });
    if (res.status !== 429 || attempt >= maxRetries) return res;
    const retryAfterSec = Number(res.headers.get('Retry-After'));
    const backoffMs = (Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : 500 * 2 ** attempt) + Math.random() * 250;
    await res.body?.cancel().catch(() => {});
    await sleep(backoffMs);
  }
}

async function zoomToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;
  const basic = btoa(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`);
  const res = await zoomFetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(ZOOM_ACCOUNT_ID)}`,
    { method: 'POST', headers: { Authorization: `Basic ${basic}` } },
  );
  if (!res.ok) throw new Error(`Zoom auth failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000 };
  return cachedToken.token;
}

async function zoomUserId(email: string, token: string): Promise<string> {
  const res = await zoomFetch(`https://api.zoom.us/v2/users/${encodeURIComponent(email)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Zoom user lookup failed for ${email} (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.id as string;
}

async function sendZoomSms(fromPhone: string, toPhone: string, message: string, token: string) {
  const res = await zoomFetch('https://api.zoom.us/v2/phone/sms/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender: { phone_number: fromPhone }, to_members: [{ phone_number: toPhone }], message }),
  });
  if (!res.ok) throw new Error(`Zoom send failed (${res.status}): ${await res.text()}`);
  return res.json().catch(() => ({}));
}

function toE164(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

// DRAFT COPY — flagged for sign-off before this function is deployed live,
// per the e-signing overhaul plan. {name}/{docName}/{link} are substituted
// below; keep replacements short since the signing link itself already
// takes up ~70-90 characters of a message.
const INVITE_MESSAGE = (name: string, docName: string, link: string) =>
  `Hi ${name}, ${docName} is ready for your signature from Bluebird Acquisition. Sign here: ${link}`;

interface ContractField {
  id: string;
  role: string;
  type: string;
}
interface PartyRoleDef {
  id: string;
  label: string;
}
interface PartyInput {
  role: string;
  name: string;
  phone: string;
  signOrder: number;
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
    const { templateId, leadId, name, fieldValues, parties } = body as {
      templateId: string;
      leadId?: string;
      name: string;
      fieldValues: Record<string, string>;
      parties: PartyInput[];
    };

    if (!templateId || !name || !parties?.length) return json({ error: 'Missing required fields.' }, 400);
    if (!BLUEDOCS_NUMBER.phone || !BLUEDOCS_NUMBER.email) {
      return json({ error: 'Blue Docs sending number is not configured yet.' }, 500);
    }

    const normalizedParties: (PartyInput & { e164: string })[] = [];
    for (const p of parties) {
      const e164 = toE164(p.phone ?? '');
      if (!e164) return json({ error: `"${p.name}" needs a valid phone number.` }, 400);
      normalizedParties.push({ ...p, e164 });
    }

    const { data: template, error: templateErr } = await withTimeout(
      admin.from('doc_templates').select('type, fields, party_roles, storage_path, docx_storage_path').eq('id', templateId).single(),
      'template lookup',
    );
    if (templateErr) throw templateErr;

    // Hashed at send time so the certificate can later show whether the
    // blank template itself changed between being sent and being signed —
    // tamper-evidence for the starting document, not just the finished one.
    const { data: pdfBlob, error: dlErr } = await withTimeout(
      admin.storage.from('blue-docs').download(template.storage_path),
      'template download',
    );
    if (dlErr) throw dlErr;
    const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());
    const hashBuffer = await crypto.subtle.digest('SHA-256', pdfBytes);
    const templateSha256 = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');

    const { data: instance, error: instErr } = await admin
      .from('contract_instances')
      .insert({
        template_id: templateId,
        lead_id: leadId ?? null,
        name,
        field_values: fieldValues ?? {},
        created_by: userId,
        status: 'sent',
        template_fields_snapshot: template.fields,
        template_party_roles_snapshot: template.party_roles,
        template_storage_path_snapshot: template.storage_path,
        template_docx_storage_path_snapshot: template.docx_storage_path,
        template_pdf_sha256: templateSha256,
      })
      .select('id')
      .single();
    if (instErr) throw instErr;

    const { data: insertedParties, error: partiesErr } = await admin
      .from('contract_signing_parties')
      .insert(
        normalizedParties.map((p) => ({
          contract_instance_id: instance.id,
          role: p.role,
          name: p.name,
          phone: p.e164,
          sign_order: p.signOrder,
        })),
      )
      .select('id, role, name, access_token, sign_order, phone');
    if (partiesErr) throw partiesErr;

    const firstParty = [...insertedParties].sort((a, b) => a.sign_order - b.sign_order)[0];
    const docKind = template.type === 'loi' ? 'your Letter of Intent' : name;
    const link = `https://www.bluebirdacquisition.com/crm/sign/${firstParty.access_token}`;

    try {
      const token = await withTimeout(zoomToken(), 'Zoom auth');
      await withTimeout(zoomUserId(BLUEDOCS_NUMBER.email, token), 'Zoom user lookup');
      await withTimeout(
        sendZoomSms(BLUEDOCS_NUMBER.phone, firstParty.phone, INVITE_MESSAGE(firstParty.name, docKind, link), token),
        'Zoom send',
      );
      await admin.from('contract_audit_events').insert({
        contract_instance_id: instance.id,
        party_id: firstParty.id,
        event_type: 'sent',
      });
    } catch (smsErr) {
      // The contract instance and parties are already created — an SMS
      // failure shouldn't lose that. The admin can still copy the link
      // manually from the Envelopes dashboard; this just logs the miss.
      console.error('Blue Docs invite SMS failed:', smsErr);
    }

    return json({
      instanceId: instance.id as string,
      parties: insertedParties.map((p) => ({ role: p.role, name: p.name, access_token: p.access_token, sign_order: p.sign_order })),
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unexpected error' }, 500);
  }
});
