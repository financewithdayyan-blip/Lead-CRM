// Edge Function: sync-sms-delivery-stats
//
// Pulls real per-message delivery status from Zoom and upserts it into
// sms_delivery_log, which the Dashboard's SMS performance chart reads from.
//
// Reads GET /v2/phone/reports/sms_charges — the account's Zoom app now has
// phone:read:sms_charges:admin (added 2026-08-27; the old sync used
// /v2/phone/sms/sessions instead, since that requires no extra scope, but
// it never returns the counterparty's phone number, so there was no way to
// tell a lead-outreach message from a cash-buyer conversation — both ride
// the exact same shared Zoom numbers (send-buyer-sms uses the identical
// NUMBERS map as send-sms). sms_charges carries from_number/to_number on
// every record, stored as counterparty_number so the dashboard can filter
// buyer traffic out before computing rates. One list endpoint, one page
// shape — simpler than the old two-level sessions-then-per-session-detail
// fan-out this replaced.
//
// Called by pg_cron (see migration 0111/0112) on a few-hour cadence — no
// admin JWT involved, same posture as send-reminders' cron trigger (a
// service-role Bearer token from Vault).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ZOOM_ACCOUNT_ID = Deno.env.get('ZOOM_ACCOUNT_ID')!;
const ZOOM_CLIENT_ID = Deno.env.get('ZOOM_CLIENT_ID')!;
const ZOOM_CLIENT_SECRET = Deno.env.get('ZOOM_CLIENT_SECRET')!;

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

async function zoomToken(): Promise<string> {
  const basic = btoa(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`);
  const res = await withTimeout(
    fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(ZOOM_ACCOUNT_ID)}`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}` },
    }),
    'Zoom auth',
  );
  if (!res.ok) throw new Error(`Zoom auth failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token as string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Zoom's per-second rate limit is real and expected under concurrent
// fetching, not exceptional — retries with backoff rather than aborting the
// whole sync on the first 429.
async function zoomGet(path: string, token: string, attempt = 1): Promise<any> {
  const res = await withTimeout(
    fetch(`https://api.zoom.us${path}`, { headers: { Authorization: `Bearer ${token}` } }),
    `Zoom GET ${path}`,
  );
  if (res.status === 429 && attempt <= 5) {
    await sleep(attempt * 800);
    return zoomGet(path, token, attempt + 1);
  }
  if (!res.ok) throw new Error(`Zoom GET ${path} failed (${res.status}): ${await res.text()}`);
  return res.json();
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// sms_charges caps a single query at ~1 month (matches the "Maximum report
// duration: 1 Month" note on Zoom's own Usage Reports screen) — chunked so
// an occasional larger backfill (?days=90) still works, not just the
// routine few-day lookback.
const MAX_WINDOW_DAYS = 28;

async function syncWindow(admin: ReturnType<typeof createClient>, token: string, from: Date, to: Date): Promise<number> {
  let pageToken: string | undefined;
  let messagesSeen = 0;
  do {
    const qs = new URLSearchParams({ from: isoDate(from), to: isoDate(to), page_size: '100' });
    if (pageToken) qs.set('next_page_token', pageToken);
    const page = await zoomGet(`/v2/phone/reports/sms_charges?${qs.toString()}`, token);

    const rows = (page.sms_charges ?? [])
      .filter((m: any) => m.message_id && m.sent_time)
      .map((m: any) => {
        // Whichever side has an extension number is us — the other side is
        // the real counterparty, lead or buyer, regardless of message
        // direction.
        const isOutbound = !!m.from_extension_number;
        return {
          message_id: m.message_id as string,
          session_id: (m.session_id as string) ?? '',
          direction: isOutbound ? 'Out' : 'In',
          delivery_status: m.delivery_status ? String(m.delivery_status).toLowerCase() : null,
          counterparty_number: (isOutbound ? m.to_number : m.from_number) ?? null,
          occurred_at: m.sent_time as string,
        };
      });

    if (rows.length > 0) {
      const { error } = await admin.from('sms_delivery_log').upsert(rows, { onConflict: 'message_id' });
      if (error) throw error;
    }
    messagesSeen += rows.length;
    pageToken = page.next_page_token || undefined;
  } while (pageToken);
  return messagesSeen;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const token = await zoomToken();

    // Lookback window rather than full history — keeps every routine run's
    // Zoom API usage bounded, and re-syncing the last few days on every run
    // picks up any message whose delivery_status was still pending at its
    // last sync. A larger ?days= (for an occasional backfill) gets chunked
    // into <=28-day windows, oldest first.
    const url = new URL(req.url);
    const lookbackDays = Number(url.searchParams.get('days') ?? '3');
    const overallTo = new Date();
    const overallFrom = new Date(overallTo.getTime() - lookbackDays * 86_400_000);

    let messagesSynced = 0;
    let windowStart = overallFrom;
    while (windowStart < overallTo) {
      const windowEnd = new Date(Math.min(windowStart.getTime() + MAX_WINDOW_DAYS * 86_400_000, overallTo.getTime()));
      messagesSynced += await syncWindow(admin, token, windowStart, windowEnd);
      windowStart = windowEnd;
    }

    return json({ ok: true, messagesSynced });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error syncing SMS delivery stats.' }, 500);
  }
});
