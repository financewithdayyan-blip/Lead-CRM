// Edge Function: sync-sms-delivery-stats
//
// Pulls real per-message delivery status from Zoom and upserts it into
// sms_delivery_log, which the Dashboard's SMS performance chart reads from.
// Zoom's own aggregate "SMS charges report" endpoint
// (GET /v2/phone/reports/sms_charges) needs a scope this app's Zoom OAuth
// credentials don't have (confirmed: 400, "does not contain
// scopes:[phone:read:sms_charges:admin]") — but GET /v2/phone/sms/sessions
// and GET /v2/phone/sms/sessions/{sessionId} already work with the scopes
// already granted, and the latter returns each message's real
// delivery_status, so this reconstructs the same numbers Zoom's own report
// shows from the message-level data instead.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const token = await zoomToken();

    // Lookback window rather than full history — keeps every run's Zoom API
    // usage bounded, and re-syncing the last few days on every run picks up
    // any message whose delivery_status was still pending at its last sync.
    const url = new URL(req.url);
    const lookbackDays = Number(url.searchParams.get('days') ?? '3');
    const to = new Date();
    const from = new Date(to.getTime() - lookbackDays * 86_400_000);

    // Step 1: every session with activity in the window, across every page.
    const sessionIds = new Set<string>();
    let pageToken: string | undefined;
    do {
      const qs = new URLSearchParams({ from: isoDate(from), to: isoDate(to), page_size: '100' });
      if (pageToken) qs.set('next_page_token', pageToken);
      const page = await zoomGet(`/v2/phone/sms/sessions?${qs.toString()}`, token);
      for (const s of page.sms_sessions ?? []) sessionIds.add(s.session_id);
      pageToken = page.next_page_token || undefined;
    } while (pageToken);

    // Step 2: full message history per session — each message carries its
    // own delivery_status regardless of when it was actually sent, so a
    // session touched today can still surface an older message's status
    // changing (pending -> delivered) on a later sync.
    //
    // Fetched and upserted CONCURRENTLY in small batches rather than one
    // session at a time — sequential was slow enough to blow past both a
    // manual test's client timeout and the cron job's own 120s
    // net.http_post timeout (0112), meaning the scheduled sync would have
    // silently never completed. Upserting after every batch (not once at the
    // end) means a run that does get cut off still keeps whatever progress
    // it made — upsert is idempotent, so the next run just continues.
    const CONCURRENCY = 5;
    // Bounds worst-case runtime per invocation; the 3-hour cadence (0112)
    // naturally catches up on any backlog over the next couple of runs.
    const MAX_SESSIONS = 400;
    const idsToSync = Array.from(sessionIds).slice(0, MAX_SESSIONS);

    let messagesSeen = 0;
    for (let i = 0; i < idsToSync.length; i += CONCURRENCY) {
      const batchIds = idsToSync.slice(i, i + CONCURRENCY);
      const batchRows = (
        await Promise.all(
          batchIds.map(async (sessionId) => {
            const rows: { message_id: string; session_id: string; direction: string; delivery_status: string | null; occurred_at: string }[] = [];
            let sessionPageToken: string | undefined;
            do {
              const qs = sessionPageToken ? `?next_page_token=${encodeURIComponent(sessionPageToken)}` : '';
              const detail = await zoomGet(`/v2/phone/sms/sessions/${sessionId}${qs}`, token);
              for (const m of detail.sms_histories ?? []) {
                if (!m.message_id || !m.date_time) continue;
                rows.push({
                  message_id: m.message_id,
                  session_id: sessionId,
                  direction: m.direction === 'In' ? 'In' : 'Out',
                  delivery_status: m.delivery_status ?? null,
                  occurred_at: m.date_time,
                });
              }
              sessionPageToken = detail.next_page_token || undefined;
            } while (sessionPageToken);
            return rows;
          }),
        )
      ).flat();

      if (batchRows.length > 0) {
        const { error } = await admin.from('sms_delivery_log').upsert(batchRows, { onConflict: 'message_id' });
        if (error) throw error;
      }
      messagesSeen += batchRows.length;
    }

    return json({ ok: true, sessionsFound: sessionIds.size, sessionsSynced: idsToSync.length, messagesSynced: messagesSeen });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error syncing SMS delivery stats.' }, 500);
  }
});
