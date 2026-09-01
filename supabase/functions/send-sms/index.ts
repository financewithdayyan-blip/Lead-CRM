// Edge Function: send-sms
//
// Bulk cold outreach over Zoom Phone. Admin-only.
//
// The sending window, the daily send limits and the opt-out check all live here
// rather than in the client, because the client can be bypassed and none of
// these are cosmetic — sending outside the window or to an opted-out number is
// a compliance problem, not a UX one.
//
// Pinned rather than the floating @2 tag, which silently resolves to
// whatever's newest on esm.sh — ruled out as the cause of a real stuck-send
// incident (2026-08-10) but left pinned regardless, since an unpinned major
// import re-resolving on every redeploy is a real, avoidable source of risk.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.101.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const ZOOM_ACCOUNT_ID = Deno.env.get('ZOOM_ACCOUNT_ID')!;
const ZOOM_CLIENT_ID = Deno.env.get('ZOOM_CLIENT_ID')!;
const ZOOM_CLIENT_SECRET = Deno.env.get('ZOOM_CLIENT_SECRET')!;

/** The sending identities. A bulk send auto-splits evenly across whichever
 * of these are actually configured (phone + email both set) — see
 * activeNumbers() below. A single/manual send still picks one by fromKey. */
const NUMBERS: Record<string, { phone: string; email: string; label: string }> = {
  '1': {
    phone: Deno.env.get('ZOOM_FROM_NUMBER') ?? '',
    email: Deno.env.get('ZOOM_USER_EMAIL') ?? '',
    label: Deno.env.get('ZOOM_LABEL') ?? 'Number 1',
  },
  '2': {
    phone: Deno.env.get('ZOOM_FROM_NUMBER_2') ?? '',
    email: Deno.env.get('ZOOM_USER_EMAIL_2') ?? '',
    label: Deno.env.get('ZOOM_LABEL_2') ?? 'Number 2',
  },
  '3': {
    phone: Deno.env.get('ZOOM_FROM_NUMBER_3') ?? '',
    email: Deno.env.get('ZOOM_USER_EMAIL_3') ?? '',
    label: Deno.env.get('ZOOM_LABEL_3') ?? 'Number 3',
  },
  '4': {
    phone: Deno.env.get('ZOOM_FROM_NUMBER_4') ?? '',
    email: Deno.env.get('ZOOM_USER_EMAIL_4') ?? '',
    label: Deno.env.get('ZOOM_LABEL_4') ?? 'Number 4',
  },
  '5': {
    phone: Deno.env.get('ZOOM_FROM_NUMBER_5') ?? '',
    email: Deno.env.get('ZOOM_USER_EMAIL_5') ?? '',
    label: Deno.env.get('ZOOM_LABEL_5') ?? 'Number 5',
  },
  '6': {
    phone: Deno.env.get('ZOOM_FROM_NUMBER_6') ?? '',
    email: Deno.env.get('ZOOM_USER_EMAIL_6') ?? '',
    label: Deno.env.get('ZOOM_LABEL_6') ?? 'Number 6',
  },
};

/** Numbers actually configured, in key order — a Zoom account with only 2 of
 * the 4 slots filled in still splits cleanly across just those 2. */
function activeNumbers(): [string, { phone: string; email: string; label: string }][] {
  return Object.entries(NUMBERS).filter(([, n]) => n.phone && n.email);
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

// ── Sending window ──────────────────────────────────────────────────────────

/**
 * Bulk cold outreach is allowed 7pm-6am Pakistan time (UTC+5), which is
 * 14:00-01:00 UTC. That lands at 9am-8pm US Eastern and 8am-7pm Central, so
 * every market stays inside 8am-9pm local.
 *
 * No bulk cold outreach at all on Sunday — but "Sunday" here means the
 * window that *starts* Sunday 7pm PKT (through Monday 6am PKT), not every
 * instant that happens to read as a Sunday PKT wall-clock time. Blocking by
 * literal current-moment weekday would cut Saturday's overnight window
 * short right at Sunday 00:00 instead of letting it run to 6am as normal —
 * this blocks by which evening the window *belongs to* instead, so
 * Saturday's window (spilling into Sunday morning) runs its full course,
 * and Sunday's window (spilling into Monday morning) is closed outright.
 *
 * Applies to cold outreach only. AI auto-replies answer whenever the lead
 * writes, since replying to someone who just texted you is not cold contact.
 */
export function withinSendWindow(now = new Date()): boolean {
  const utcHour = now.getUTCHours();
  // 14:00-23:59 UTC, or 00:00-00:59 UTC (the window crosses midnight UTC).
  const inWindow = utcHour >= 14 || utcHour < 1;
  if (!inWindow) return false;

  // UTC 14:00 is 19:00 Pakistan — never rolls past midnight, so that start
  // hour's UTC calendar date and Pakistan calendar date are the same date.
  // The tail end (utcHour < 1) belongs to the window that started at UTC
  // 14:00 the PREVIOUS UTC day, not today.
  const windowStartDate = new Date(now);
  if (utcHour < 1) windowStartDate.setUTCDate(windowStartDate.getUTCDate() - 1);
  return windowStartDate.getUTCDay() !== 0; // 0 = Sunday
}

// ── Zoom auth ───────────────────────────────────────────────────────────────

// Cached for the life of the instance. Zoom tokens last an hour; re-minting one
// per message would be both slow and needlessly rate-limited.
let cachedToken: { token: string; expiresAt: number } | null = null;

// Every outbound fetch in this file gets this same cap. Without it, a Zoom
// endpoint that hangs instead of erroring stalls the whole job forever —
// bulk_sms_jobs sits at 'running' with nothing left to ever mark it failed,
// since nothing ever throws. Found this the hard way: two separate jobs
// (one with 1441 leads, one with just 5) both got stuck at exactly
// created_at === updated_at, meaning execution never got past the very
// first Zoom call. A timeout turns that hang into a real, caught error.
const FETCH_TIMEOUT_MS = 15_000;

// PostgREST calls get a timeout via .abortSignal(AbortSignal.timeout(...)),
// but auth-js methods (like the getUser() call below) don't support that
// same chaining — this wraps any promise with the same cap, turning a hang
// into a real, caught "timed out" error instead of leaving the whole
// invocation stuck with nothing to ever mark the job failed. This exact
// class of bug (an unprotected call hanging forever) is what caused a real
// stuck-send incident on 2026-08-10 — every admin.from()/rpc() call in this
// file now has an explicit timeout for that reason, not just the Zoom ones.
function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timed out waiting on ${label}`)), FETCH_TIMEOUT_MS)),
  ]);
}

// Zoom's per-second rate limit bites hardest on exactly the calls this file
// makes in bursts: a bulk job runs as ~2603/100 = 27 separate chunk
// invocations, and every one of them re-resolves the Zoom auth token and
// every sending number's user id from scratch (in-memory caches above don't
// survive across invocations). Retrying a 429 with backoff, instead of
// throwing immediately, is what keeps one rate-limited call from taking down
// an entire 100-lead chunk that had nothing else wrong with it — found for
// real on 2026-08-10 when a bulk send that was finally reaching Zoom (after
// the Resume bug fix) started failing chunks on "Zoom user lookup failed
// ... 429".
async function zoomFetch(url: string, options: RequestInit, maxRetries = 4): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), ...options });
    if (res.status !== 429 || attempt >= maxRetries) return res;
    const retryAfterSec = Number(res.headers.get('Retry-After'));
    const backoffMs = (Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : 500 * 2 ** attempt)
      + Math.random() * 250;
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
  cachedToken = {
    token: data.access_token,
    // 60s of slack so a token can't expire mid-burst.
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000,
  };
  return cachedToken.token;
}

// Zoom user ids never change, so cache them for the instance too.
const userIdCache = new Map<string, string>();

async function zoomUserId(email: string, token: string): Promise<string> {
  const hit = userIdCache.get(email);
  if (hit) return hit;

  const res = await zoomFetch(`https://api.zoom.us/v2/users/${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Zoom user lookup failed for ${email} (${res.status}): ${await res.text()}`);

  const data = await res.json();
  userIdCache.set(email, data.id);
  return data.id;
}

async function sendZoomSms(fromPhone: string, toPhone: string, message: string, token: string) {
  const res = await zoomFetch('https://api.zoom.us/v2/phone/sms/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: { phone_number: fromPhone },
      to_members: [{ phone_number: toPhone }],
      message,
    }),
  });

  if (!res.ok) throw new Error(`Zoom send failed (${res.status}): ${await res.text()}`);
  return res.json().catch(() => ({}));
}

// ── Message rendering ───────────────────────────────────────────────────────

/** Replaces {{first_name}}-style placeholders. Unknown tokens resolve to ''. */
function render(template: string, lead: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, key: string) => {
    const v = lead[key.toLowerCase()];
    return v == null ? '' : String(v);
  }).replace(/\s{2,}/g, ' ').trim();
}

/** E.164 for Zoom. Ten digits get a US country code; eleven starting with 1 already have one. */
function toE164(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  // Declared out here so the outermost catch can still fail the job if
  // something throws before or after the main body below.
  let jobId: string | undefined;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  /** Fails the job (if one was passed) and returns the same error shape a
   * caller with no job would get, so BulkSmsModal's own error handling
   * still works unchanged for a same-turn failure (e.g. outside window). */
  async function bail(message: string, status: number) {
    if (jobId) {
      await withTimeout(
        admin.from('bulk_sms_jobs').update({ status: 'failed', error: message, updated_at: nowIso() }).eq('id', jobId)
          .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
        'bail() job update',
      ).catch(() => {});
    }
    return json({ error: message }, status);
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';

    // A client scoped to the caller's own token, not the admin/service-role
    // client — the standard, documented way to verify who's calling, rather
    // than decoding an arbitrary bearer through the admin client's own
    // getUser(jwt) path.
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await withTimeout(callerClient.auth.getUser(), 'auth.getUser()');
    const userId = userData?.user?.id;
    if (!userId) return json({ error: 'Not signed in.' }, 401);

    const { data: profile } = await withTimeout(
      admin.from('profiles').select('role').eq('id', userId).single().abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
      'profile lookup',
    );
    if (profile?.role !== 'admin') return json({ error: 'Admins only.' }, 403);

    const body = await req.json();
    const {
      leadIds = [],
      templatesByTag = {},
      defaultTemplate = '',
      fromKey = '1',
      perMessageDelayMs = 400,
      dailyLimits = {},
      jobId: jobIdIn,
      isManualReply = false,
    } = body as {
      leadIds: string[];
      templatesByTag: Record<string, string>;
      defaultTemplate: string;
      fromKey: string;
      perMessageDelayMs?: number;
      /** Per-number daily cap (resets at midnight PKT — see sends_in_window),
       * keyed '1'-'4' matching NUMBERS above. Missing or <= 0 for a key means
       * unlimited for that number. */
      dailyLimits?: Record<string, number>;
      jobId?: string;
      /** A human replying by hand from the lead's own SMS Thread, not bulk
       * cold outreach — folds useSendManualReply's own follow-up "pause AI
       * on this lead" write into the same parallel batch as send_log/
       * lead_activities below, instead of a second full round trip the
       * client used to make only after this function had already returned. */
      isManualReply?: boolean;
    };
    jobId = jobIdIn;

    if (!leadIds.length) return bail('No leads selected.', 400);

    // A resumed job was sitting at 'failed' with its old error message —
    // clear both back to 'running' the moment real work starts again on it,
    // so the page's status badge reflects what's actually happening. Harmless
    // no-op for a fresh job, which useCreateBulkSmsJob already inserts as
    // 'running'.
    if (jobId) {
      await withTimeout(
        admin.from('bulk_sms_jobs').update({ status: 'running', error: null, updated_at: nowIso() }).eq('id', jobId)
          .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
        'mark job running',
      );
    }

    // Tag names, and any number a lead is already pinned to from a prior
    // send, come along so both the per-lead template and the sender choice
    // below can use them — moved ahead of the sender logic because a single
    // send now needs to know the pin before it can pick a number at all.
    // A single .in('id', leadIds) with a thousand-plus UUIDs turns into a URL
    // tens of thousands of characters long — PostgREST/the CDN in front of it
    // doesn't cleanly error on that, it just hangs, which is exactly how two
    // separate 1441-lead jobs got stuck at 'running' forever with zero
    // progress even after the Zoom timeouts were added below. Chunking keeps
    // every single request's URL a sane size regardless of batch size.
    const LEADS_CHUNK_SIZE = 150;
    const leadsById = new Map<string, any>();
    for (let i = 0; i < leadIds.length; i += LEADS_CHUNK_SIZE) {
      const chunk = leadIds.slice(i, i + LEADS_CHUNK_SIZE);
      const { data: chunkLeads, error: leadErr } = await withTimeout(
        admin
          .from('leads')
          .select(
            'id, first_name, last_name, phone, phone_norm, address, city, state, zip, opted_out, stage, assigned_sms_number, lead_tags(tag_id, tags(name))',
          )
          .in('id', chunk)
          .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
        'fetching leads',
      );
      if (leadErr) throw leadErr;
      for (const l of chunkLeads ?? []) leadsById.set(l.id, l);
    }

    // Preserve the caller's own ordering rather than whatever order Postgres
    // happens to return, so the round-robin split below is deterministic.
    const leads = leadIds.map((id) => leadsById.get(id)).filter((l): l is NonNullable<typeof l> => !!l);

    function isActiveKey(key: string | null | undefined): key is string {
      return !!key && !!NUMBERS[key]?.phone && !!NUMBERS[key]?.email;
    }

    // Bulk (more than one lead) auto-splits evenly across every configured
    // number, switching to the next once a number's share — or its own
    // daily cap — is reached (individual leads already pinned to a
    // number, handled in the send loop below, sit outside this split
    // entirely). A single send (a manual reply, or one lead picked in the
    // bulk modal) instead uses exactly one number: whichever number this
    // lead is already pinned to from an earlier send — so a reply always
    // lands in the same Zoom thread as everything before it rather than
    // wherever fromKey happens to default to — or, if this is the first
    // message this lead has ever gotten, the number chosen via fromKey.
    let senders: [string, { phone: string; email: string; label: string }][];
    if (leadIds.length > 1) {
      senders = activeNumbers();
      if (!senders.length) return bail('No sending numbers are configured.', 400);
    } else {
      const pinned = leads[0]?.assigned_sms_number as string | null | undefined;
      const effectiveKey = isActiveKey(pinned) ? pinned : fromKey;
      const single = NUMBERS[effectiveKey];
      if (!single?.phone || !single.email) {
        return bail(`Sending number "${effectiveKey}" is not configured.`, 400);
      }
      senders = [[effectiveKey, single]];
    }

    // The window restricts bulk cold outreach only. A single send — a manual
    // reply to an already-open conversation, or a one-off text to one lead —
    // is never cold in the same sense and always goes through, checked before
    // anything else so a blocked run costs no Zoom calls.
    if (leadIds.length > 1 && !withinSendWindow()) {
      return bail(
        'Outside the sending window. Bulk outreach runs 7pm-6am Pakistan time (9am-8pm US Eastern).',
        422,
      );
    }

    // Each number's own remaining capacity for today (PKT) against its own
    // configured limit, checked once up front. A number already at its cap
    // is simply skipped by the rotation below rather than blocking the whole
    // run — and a number with no limit set (or 0) never even gets checked,
    // same as the old "dailyLimit <= 0" unlimited case, just per-number now.
    const dailyRemaining = new Map<string, number>();
    await withTimeout(Promise.all(
      senders.map(async ([key, n]) => {
        const limit = dailyLimits[key] ?? 0;
        if (limit <= 0) return;
        const { data: used } = await admin
          .rpc('sends_in_window', { p_sent_from: n.phone, p_hours: 24 })
          .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS));
        dailyRemaining.set(key, Math.max(0, limit - Number(used ?? 0)));
      }),
    ), 'daily limit check');
    if (senders.every(([key]) => (dailyLimits[key] ?? 0) > 0 && (dailyRemaining.get(key) ?? 0) <= 0)) {
      return bail('Every configured number has already reached its own daily limit.', 422);
    }

    const token = await withTimeout(zoomToken(), 'Zoom auth');
    // Resolved even though the send endpoint takes the number, because Zoom
    // rejects sends from a number the authed user doesn't own. Sequential,
    // not Promise.all — firing every sender's lookup at Zoom in the same
    // instant is exactly what was tripping its per-second rate limit on this
    // endpoint on 2026-08-10 (a bulk job invokes this fresh on every ~100-lead
    // chunk, so it happens dozens of times over one job). zoomFetch's own
    // 429 retry is the real safety net; this just avoids provoking it.
    for (const [, n] of senders) {
      await withTimeout(zoomUserId(n.email, token), 'Zoom user lookup');
    }

    const sent: string[] = [];
    const skipped: { leadId: string; reason: string }[] = [];
    const failed: { leadId: string; error: string }[] = [];
    // Reflects real outcomes, only ever written by phase 2 — used solely for
    // the perNumber summary in the response.
    const sentByNumber = new Map<string, number>(senders.map(([key]) => [key, 0]));
    // Reflects the plan itself, written during phase 1 — this is what the
    // daily-cap and target-share checks below actually gate on, since with
    // sending split into its own concurrent phase 2, "has this number
    // already sent enough" has to be answered from what's been assigned to
    // it so far in this batch, not from completed sends that haven't
    // happened yet.
    const assignedCount = new Map<string, number>(senders.map(([key]) => [key, 0]));

    // True round robin — each non-pinned lead in sequence gets the NEXT
    // number in rotation (1,2,3,4,1,2,3,4,...), not "fill number 1's whole
    // share, then move to number 2". A number that's hit its own daily cap
    // is simply skipped when its turn in the rotation comes up, rather than
    // picked — the rotation itself keeps moving past it for later leads too.
    let rotation = 0;

    function hasCapacity(key: string): boolean {
      if ((dailyLimits[key] ?? 0) <= 0) return true;
      return (assignedCount.get(key) ?? 0) < (dailyRemaining.get(key) ?? 0);
    }

    /** Next sender index in rotation with capacity, or -1 if every number is
     * at its cap. Doesn't advance `rotation` itself — only actually assigning
     * a lead does that, so a capacity-skip here doesn't throw off the
     * sequence for leads after it. */
    function nextSender(): number {
      for (let i = 0; i < senders.length; i++) {
        const idx = (rotation + i) % senders.length;
        if (hasCapacity(senders[idx][0])) return idx;
      }
      return -1;
    }

    // ── Phase 1: plan — decide every lead's outcome (skip) or sender
    // assignment up front, with no Zoom calls yet. This is what makes phase 2
    // safe to parallelize: which number a lead uses never depends on when its
    // send actually happens, only on this pass's fixed iteration order. ──────
    type Planned = {
      lead: NonNullable<(typeof leads)[number]>;
      key: string;
      from: { phone: string; email: string; label: string };
      message: string;
      to: string;
      isPinned: boolean;
    };
    const planned: Planned[] = [];
    const skipItemUpdates: Promise<unknown>[] = [];

    function markSkipped(leadId: string, reason: string) {
      skipped.push({ leadId, reason });
      if (jobId) {
        skipItemUpdates.push(
          admin.from('bulk_sms_job_items').update({ status: 'skipped', detail: reason, updated_at: nowIso() })
            .eq('job_id', jobId).eq('lead_id', leadId)
            .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
        );
      }
    }

    for (const lead of leads) {
      if (lead.opted_out) {
        markSkipped(lead.id, 'opted out');
        continue;
      }

      const to = toE164(lead.phone ?? '');
      if (!to) {
        markSkipped(lead.id, 'no usable phone number');
        continue;
      }

      // First tag with a template wins; otherwise the default.
      const tagNames: string[] = (lead.lead_tags ?? [])
        .map((lt: any) => lt.tags?.name)
        .filter(Boolean);
      const template = tagNames.map((n) => templatesByTag[n]).find(Boolean) ?? defaultTemplate;
      if (!template) {
        markSkipped(lead.id, 'no template for this lead\'s tags');
        continue;
      }

      // A lead already pinned to a number (from an earlier send) sticks to
      // it instead of the round robin, so replies keep landing in the same
      // Zoom thread rather than fragmenting across numbers. This sits
      // outside the rotation entirely — it never advances `rotation`.
      let key: string;
      let from: { phone: string; email: string; label: string };
      const pinned = lead.assigned_sms_number as string | null | undefined;
      const isPinned = leadIds.length > 1 && isActiveKey(pinned) && senders.some(([k]) => k === pinned);

      if (isPinned) {
        if (!hasCapacity(pinned!)) {
          markSkipped(lead.id, 'assigned number has reached its daily limit');
          continue;
        }
        key = pinned!;
        from = NUMBERS[pinned!];
      } else {
        const idx = nextSender();
        if (idx === -1) {
          markSkipped(lead.id, 'every configured number has reached its daily limit');
          continue;
        }
        [key, from] = senders[idx];
        rotation = (idx + 1) % senders.length;
      }
      assignedCount.set(key, (assignedCount.get(key) ?? 0) + 1);

      const message = render(template, {
        first_name: lead.first_name,
        last_name: lead.last_name,
        address: lead.address,
        city: lead.city,
        state: lead.state,
        zip: lead.zip,
      });

      planned.push({ lead, key, from, message, to, isPinned });
    }

    if (skipItemUpdates.length) await withTimeout(Promise.all(skipItemUpdates), 'recording skipped leads').catch(() => {});

    // ── Phase 2: execute — one queue per number, run concurrently. Numbers
    // are genuinely independent Zoom senders, so there's no shared rate limit
    // between them; only sends on the *same* number stay paced with the
    // per-message delay. This is what makes a 4-way-split bulk send finish in
    // roughly a quarter of the old fully-serial wall time. ──────────────────
    const groups = new Map<string, Planned[]>();
    for (const item of planned) {
      if (!groups.has(item.key)) groups.set(item.key, []);
      groups.get(item.key)!.push(item);
    }

    async function processGroup(key: string, items: Planned[]) {
      const from = NUMBERS[key];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const { lead, message, to } = item;

        // Atomic claim, not just a status write: this is what makes it safe
        // for bulk-sms-dispatcher (the pg_cron-driven worker) and this
        // function to both be reachable for the same job without ever
        // double-texting a lead. The .eq('status','queued') + .select('id')
        // combination means the UPDATE only actually matches — and only
        // this invocation only proceeds to Zoom — if the row was still
        // 'queued' at the moment this exact statement ran; a concurrent
        // caller racing the same lead sees zero rows back and skips it
        // instead of sending. See supabase/functions/send-reminders for the
        // same claim-before-work shape already proven in this codebase.
        if (jobId) {
          let claimed = false;
          try {
            const { data: claimRows } = await withTimeout(
              admin.from('bulk_sms_job_items').update({ status: 'sending', updated_at: nowIso() })
                .eq('job_id', jobId).eq('lead_id', lead.id).eq('status', 'queued')
                .select('id')
                .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
              'claim item before sending',
            );
            claimed = !!claimRows?.length;
          } catch {
            claimed = false;
          }

          if (!claimed) {
            // Someone else already claimed this lead — do NOT call Zoom,
            // and write nothing (leave the item exactly as whoever won
            // already set it, rather than stomping a legitimate 'sent').
            skipped.push({ leadId: lead.id, reason: 'already claimed by another process — no duplicate text sent' });
            continue;
          }
        }

        try {
          await withTimeout(sendZoomSms(from.phone, to, message, token), 'Zoom send');

          // Cold leads advance to Contacted. Anything further along keeps its
          // stage — a lead already in Negotiation shouldn't regress. The
          // first time a lead is ever sent to, the number it went out from
          // becomes its permanent home for every send after this one.
          const leadUpdates: Record<string, unknown> = {};
          if (lead.stage === 'new') leadUpdates.stage = 'contacted';
          if (lead.assigned_sms_number !== key) leadUpdates.assigned_sms_number = key;
          if (isManualReply) {
            leadUpdates.ai_reply_paused = true;
            leadUpdates.photo_wait_ai_active = false;
            // A follow-up doesn't have to be a call — texting a lead by hand
            // is just as much "I followed up" as logging a call is (see
            // useAddActivity's next_follow_up clear for the call side of
            // this same rule). Scoped to isManualReply so a bulk cold-
            // outreach blast to a lead who happens to have a Next Follow-Up
            // date set doesn't silently clear it.
            leadUpdates.next_follow_up = null;
          }

          // These three writes are independent of each other, so they run
          // together rather than one-after-another — the send_log row is
          // still guaranteed to exist before the function can return success,
          // just no longer at the cost of three serial round trips.
          await withTimeout(Promise.all([
            admin.from('send_log').insert({
              user_id: userId,
              lead_id: lead.id,
              phone: to,
              phone_norm: lead.phone_norm,
              sent_from: from.phone,
              body: message,
            }).abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
            Object.keys(leadUpdates).length > 0
              ? admin.from('leads').update(leadUpdates).eq('id', lead.id).abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS))
              : Promise.resolve(null),
            admin.from('lead_activities').insert({
              lead_id: lead.id,
              user_id: userId,
              type: 'sms',
              body: message,
              meta: { direction: 'outbound', from: from.phone, to, label: from.label },
            }).abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
          ]), 'recording the send').catch(() => {});

          sent.push(lead.id);
          sentByNumber.set(key, (sentByNumber.get(key) ?? 0) + 1);

          if (jobId) {
            await withTimeout(
              admin.from('bulk_sms_job_items').update({ status: 'sent', sent_from: from.phone, updated_at: nowIso() })
                .eq('job_id', jobId).eq('lead_id', lead.id)
                .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
              'mark item sent',
            ).catch(() => {});
          }
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          failed.push({ leadId: lead.id, error: errMsg });
          if (jobId) {
            await withTimeout(
              admin.from('bulk_sms_job_items').update({ status: 'failed', detail: errMsg.slice(0, 500), updated_at: nowIso() })
                .eq('job_id', jobId).eq('lead_id', lead.id)
                .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
              'mark item failed',
            ).catch(() => {});
          }
        }

        // Only paces the *next* send on this same number — nothing left to
        // protect after the last item, so no point making the caller (or a
        // single manual reply, which is always a "group" of exactly one)
        // wait out a delay that has nothing left to space out.
        if (perMessageDelayMs > 0 && i < items.length - 1) await sleep(perMessageDelayMs);
      }
    }

    await Promise.all(Array.from(groups.entries()).map(([key, items]) => processGroup(key, items)));

    // A caller may only be sending one chunk of a much larger job (see
    // useSendBulkSms, which splits anything past a few hundred leads across
    // several invocations so no single one runs long enough to hit the
    // platform's execution-time limit). Only flip the job to 'completed' once
    // nothing is left queued or sending for it — otherwise the first chunk to
    // finish would prematurely mark a 1000+ lead job done.
    if (jobId) {
      const { count: remaining } = await withTimeout(
        admin
          .from('bulk_sms_job_items')
          .select('id', { count: 'exact', head: true })
          .eq('job_id', jobId)
          .in('status', ['queued', 'sending'])
          .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
        'checking remaining items',
      );
      if (!remaining) {
        await withTimeout(
          admin.from('bulk_sms_jobs').update({ status: 'completed', completed_at: nowIso(), updated_at: nowIso() }).eq('id', jobId)
            .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
          'mark job completed',
        );
      }
    }

    return json({
      sent: sent.length,
      skipped,
      failed,
      perNumber: senders.map(([key, n]) => ({ key, label: n.label, sent: sentByNumber.get(key) ?? 0 })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (jobId) {
      await withTimeout(
        admin.from('bulk_sms_jobs').update({ status: 'failed', error: message, updated_at: nowIso() }).eq('id', jobId)
          .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
        'recording final failure',
      ).catch(() => {});
    }
    return json({ error: message }, 500);
  }
});
