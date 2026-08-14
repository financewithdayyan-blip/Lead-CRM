// Edge Function: contract-reminder-sweep
//
// Blue Docs overhaul, phase 1c — pg_cron-driven nudge for a signer who's had
// an unlocked link sitting unsigned for a while. Never called by a browser;
// auth is the x-internal-secret header, same shape as bulk-sms-dispatcher/
// ai-reply-review (a purpose-made Vault secret, never the service-role key —
// see 0077's own comment on the format-drift risk of that older pattern).
//
// The actual "who's due" and "claim so nothing gets reminded twice" logic
// lives in claim_contract_reminders() (0091) — this function's only job is
// running that RPC and sending whatever it hands back.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const INTERNAL_SECRET = Deno.env.get('CONTRACT_REMINDER_SECRET')!;

const ZOOM_ACCOUNT_ID = Deno.env.get('ZOOM_ACCOUNT_ID')!;
const ZOOM_CLIENT_ID = Deno.env.get('ZOOM_CLIENT_ID')!;
const ZOOM_CLIENT_SECRET = Deno.env.get('ZOOM_CLIENT_SECRET')!;
// Same shared-number reasoning as create-contract-instance/submit-signature
// — 217-408-2781 is NUMBERS['2'] in the outreach pool, reused here rather
// than duplicated into a separate secret pair.
const BLUEDOCS_NUMBER = {
  phone: Deno.env.get('ZOOM_FROM_NUMBER_2') ?? '',
  email: Deno.env.get('ZOOM_USER_EMAIL_2') ?? '',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const FETCH_TIMEOUT_MS = 15_000;
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

// DRAFT COPY — flagged for sign-off, same as the other Blue Docs SMS
// templates (create-contract-instance, submit-signature).
const REMINDER_MESSAGE = (name: string, docName: string, link: string) =>
  `Reminder: ${docName} is still waiting on your signature, ${name}. Sign here: ${link}`;

Deno.serve(async (req) => {
  if (req.headers.get('x-internal-secret') !== INTERNAL_SECRET) {
    return json({ error: 'unauthorized' }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const { data: claimed, error: claimErr } = await admin.rpc('claim_contract_reminders', { p_limit: 50 });
    if (claimErr) throw claimErr;
    if (!claimed?.length) return json({ ok: true, reminded: 0 });

    if (!BLUEDOCS_NUMBER.phone || !BLUEDOCS_NUMBER.email) {
      return json({ ok: false, error: 'Blue Docs sending number is not configured.' }, 500);
    }

    const token = await zoomToken();
    await zoomUserId(BLUEDOCS_NUMBER.email, token);

    let reminded = 0;
    const failures: { id: string; error: string }[] = [];
    for (const party of claimed as { id: string; name: string; phone: string; access_token: string; contract_instance_id: string; contract_name: string }[]) {
      try {
        const link = `https://www.bluebirdacquisition.com/crm/sign/${party.access_token}`;
        await sendZoomSms(BLUEDOCS_NUMBER.phone, party.phone, REMINDER_MESSAGE(party.name, party.contract_name ?? 'a document', link), token);
        await admin.from('contract_audit_events').insert({
          contract_instance_id: party.contract_instance_id,
          party_id: party.id,
          event_type: 'reminder_sent',
        });
        reminded++;
      } catch (e) {
        failures.push({ id: party.id, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return json({ ok: true, reminded, failed: failures });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unexpected error' }, 500);
  }
});
