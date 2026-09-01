// Edge Function: bulk-sms-dispatcher
//
// Called every minute by pg_cron (see supabase/migrations/0085_bulk_sms_dispatcher_cron.sql),
// never by a browser. This is what makes bulk SMS sending survive a closed
// or backgrounded tab: it picks the oldest bulk_sms_jobs row still
// 'running', sends its next batch of up to 100 queued leads, and returns —
// the next tick picks up wherever this one left off, exactly the same
// "leave the rest for next tick" shape already proven by send-reminders and
// ai-reply-review.
//
// A self-contained duplicate of send-sms's helpers and Phase 1/Phase 2
// logic, not a shared import — matching this codebase's own established
// convention (see sms-backfill/index.ts's own comment on why it keeps its
// own copy rather than importing from send-sms) so an edit made for this
// function's sake can never silently change send-sms's behavior. The one
// piece of logic that must stay identical between the two — the atomic
// per-lead claim right before sending — is duplicated verbatim; see the
// comment on it below and the matching one in send-sms/index.ts.
//
// Deliberately NOT a self-invoking function (no EdgeRuntime.waitUntil, no
// fetching its own gateway URL) and does NOT call send-sms at all — see the
// plan's Context section for why the 2026-08-10 incident makes both of
// those specifically unsafe. Auth is a purpose-made Vault secret checked
// against a custom header, mirroring ai-reply-review exactly, not the
// service role key (see that function's own comment on why: deployed edge
// functions resolve SERVICE_ROLE_KEY to a newer key format than what a
// long-lived Vault-stored copy would have, which would silently 401 every
// run forever).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.101.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ZOOM_ACCOUNT_ID = Deno.env.get('ZOOM_ACCOUNT_ID')!;
const ZOOM_CLIENT_ID = Deno.env.get('ZOOM_CLIENT_ID')!;
const ZOOM_CLIENT_SECRET = Deno.env.get('ZOOM_CLIENT_SECRET')!;

const DISPATCH_SECRET = Deno.env.get('BULK_SMS_DISPATCH_SECRET')!;

// Called by pg_cron via pg_net, never by a user — no CORS, no JWT check.
function isAuthorizedCaller(req: Request): boolean {
  return req.headers.get('x-internal-secret') === DISPATCH_SECRET;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

// One batch per tick — same size as send-sms's own proven-safe
// BULK_CHUNK_SIZE, the only batch size this codebase has empirically
// validated against the platform's execution-time ceiling.
const BATCH_SIZE = 100;

// ── Sending window (verbatim copy of send-sms's own — must stay identical) ──

export function withinSendWindow(now = new Date()): boolean {
  const utcHour = now.getUTCHours();
  const inWindow = utcHour >= 14 || utcHour < 1;
  if (!inWindow) return false;

  // See send-sms's own copy of this function for the full explanation —
  // blocks by which evening the window *started* (Sunday 7pm-Monday 6am
  // PKT closed outright) rather than by the current PKT wall-clock weekday,
  // so Saturday's overnight window still runs its full course into Sunday
  // morning instead of getting cut short at Sunday 00:00.
  const windowStartDate = new Date(now);
  if (utcHour < 1) windowStartDate.setUTCDate(windowStartDate.getUTCDate() - 1);
  return windowStartDate.getUTCDay() !== 0; // 0 = Sunday
}

// ── Zoom auth (verbatim copy of send-sms's own) ──────────────────────────────

let cachedToken: { token: string; expiresAt: number } | null = null;
const FETCH_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timed out waiting on ${label}`)), FETCH_TIMEOUT_MS)),
  ]);
}

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
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000 };
  return cachedToken.token;
}

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
    body: JSON.stringify({ sender: { phone_number: fromPhone }, to_members: [{ phone_number: toPhone }], message }),
  });

  if (!res.ok) throw new Error(`Zoom send failed (${res.status}): ${await res.text()}`);
  return res.json().catch(() => ({}));
}

// ── Message rendering (verbatim copy) ────────────────────────────────────────

function render(template: string, lead: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, key: string) => {
    const v = lead[key.toLowerCase()];
    return v == null ? '' : String(v);
  }).replace(/\s{2,}/g, ' ').trim();
}

function toE164(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

// ── Number config (verbatim copy) ────────────────────────────────────────────

const NUMBERS: Record<string, { phone: string; email: string; label: string }> = {
  '1': { phone: Deno.env.get('ZOOM_FROM_NUMBER') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL') ?? '', label: Deno.env.get('ZOOM_LABEL') ?? 'Number 1' },
  '2': { phone: Deno.env.get('ZOOM_FROM_NUMBER_2') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL_2') ?? '', label: Deno.env.get('ZOOM_LABEL_2') ?? 'Number 2' },
  '3': { phone: Deno.env.get('ZOOM_FROM_NUMBER_3') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL_3') ?? '', label: Deno.env.get('ZOOM_LABEL_3') ?? 'Number 3' },
  '4': { phone: Deno.env.get('ZOOM_FROM_NUMBER_4') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL_4') ?? '', label: Deno.env.get('ZOOM_LABEL_4') ?? 'Number 4' },
  '5': { phone: Deno.env.get('ZOOM_FROM_NUMBER_5') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL_5') ?? '', label: Deno.env.get('ZOOM_LABEL_5') ?? 'Number 5' },
  '6': { phone: Deno.env.get('ZOOM_FROM_NUMBER_6') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL_6') ?? '', label: Deno.env.get('ZOOM_LABEL_6') ?? 'Number 6' },
};

function activeNumbers(): [string, { phone: string; email: string; label: string }][] {
  return Object.entries(NUMBERS).filter(([, n]) => n.phone && n.email);
}

function isActiveKey(key: string | null | undefined): key is string {
  return !!key && !!NUMBERS[key]?.phone && !!NUMBERS[key]?.email;
}

// ── Handler ───────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (!isAuthorizedCaller(req)) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    // 1. Oldest running job first. In practice only one bulk send is ever
    // active at a time (sms-backfill's own "refuse to run while any
    // bulk_sms_jobs is running" check already relies on this), so this
    // degrades to round-robin-by-tick in the rare case more than one is
    // somehow running concurrently, rather than breaking.
    const { data: job } = await withTimeout(
      admin.from('bulk_sms_jobs').select('id, user_id, total, config').eq('status', 'running')
        .order('created_at', { ascending: true }).limit(1).maybeSingle()
        .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
      'select running job',
    );
    if (!job) return json({ ok: true, skipped: true, reason: 'no running job' });

    // 2. useCreateBulkSmsJob inserts the job row, then the item rows, as two
    // separate statements — a tick landing in that gap must not mistake
    // "no items yet" for "nothing to do" and prematurely mark it done.
    const { count: itemCount } = await withTimeout(
      admin.from('bulk_sms_job_items').select('id', { count: 'exact', head: true }).eq('job_id', job.id)
        .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
      'count job items',
    );
    if ((itemCount ?? 0) < job.total) {
      return json({ ok: true, skipped: true, reason: 'job items still being inserted', jobId: job.id });
    }

    // 3. Next batch of queued items for this job.
    const { data: queuedItems } = await withTimeout(
      admin.from('bulk_sms_job_items').select('id, lead_id').eq('job_id', job.id).eq('status', 'queued')
        .order('id', { ascending: true }).limit(BATCH_SIZE)
        .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
      'select queued items',
    );
    const leadIds = (queuedItems ?? []).map((r) => r.lead_id).filter((id): id is string => !!id);

    if (!leadIds.length) {
      // Nothing queued — either genuinely done (mark completed below) or
      // everything still 'sending'/'failed' from a prior tick, in which
      // case there's nothing more this tick can do.
      const { count: remaining } = await withTimeout(
        admin.from('bulk_sms_job_items').select('id', { count: 'exact', head: true }).eq('job_id', job.id)
          .in('status', ['queued', 'sending']).abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
        'checking remaining items',
      );
      if (!remaining) {
        await withTimeout(
          admin.from('bulk_sms_jobs').update({ status: 'completed', completed_at: nowIso(), updated_at: nowIso() }).eq('id', job.id)
            .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
          'mark job completed',
        );
        return json({ ok: true, jobId: job.id, completed: true });
      }
      return json({ ok: true, jobId: job.id, skipped: true, reason: 'nothing queued, items still sending' });
    }

    // 4. Bulk cold outreach only runs inside the sending window — a batch
    // of exactly one manually-sent lead is never job-tracked in practice,
    // but keep the ">1" guard identical to send-sms's own for consistency.
    if (leadIds.length > 1 && !withinSendWindow()) {
      return json({ ok: true, jobId: job.id, skipped: true, reason: 'outside send window' });
    }

    // Note: no fromKey here, unlike send-sms — this function only ever
    // processes job-tracked bulk batches (never a true single manual
    // reply, which always goes through send-sms directly with no jobId),
    // so it always uses round-robin + per-lead pinning below, never
    // send-sms's separate single-lead "one forced sender" branch.
    const config = (job.config ?? {}) as {
      templatesByTag?: Record<string, string>;
      defaultTemplate?: string;
      perMessageDelayMs?: number;
      dailyLimits?: Record<string, number>;
    };
    const templatesByTag = config.templatesByTag ?? {};
    const defaultTemplate = config.defaultTemplate ?? '';
    const perMessageDelayMs = config.perMessageDelayMs ?? 400;
    const dailyLimits = config.dailyLimits ?? {};

    // Same lead-fetch chunking as send-sms, for the same reason (a huge
    // .in('id', leadIds) URL hangs rather than erroring) — moot at
    // BATCH_SIZE=100, kept for consistency and because it's free.
    const LEADS_CHUNK_SIZE = 150;
    const leadsById = new Map<string, any>();
    for (let i = 0; i < leadIds.length; i += LEADS_CHUNK_SIZE) {
      const chunk = leadIds.slice(i, i + LEADS_CHUNK_SIZE);
      const { data: chunkLeads, error: leadErr } = await withTimeout(
        admin.from('leads')
          .select('id, first_name, last_name, phone, phone_norm, address, city, state, zip, opted_out, stage, assigned_sms_number, lead_tags(tag_id, tags(name))')
          .in('id', chunk).abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
        'fetching leads',
      );
      if (leadErr) throw leadErr;
      for (const l of chunkLeads ?? []) leadsById.set(l.id, l);
    }
    const leads = leadIds.map((id) => leadsById.get(id)).filter((l): l is NonNullable<typeof l> => !!l);

    let senders: [string, { phone: string; email: string; label: string }][] = activeNumbers();
    if (!senders.length) {
      await withTimeout(
        admin.from('bulk_sms_jobs').update({ status: 'failed', error: 'No sending numbers are configured.', updated_at: nowIso() }).eq('id', job.id)
          .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
        'fail job (no senders)',
      );
      return json({ ok: true, jobId: job.id, failed: true, reason: 'no sending numbers configured' });
    }

    const dailyRemaining = new Map<string, number>();
    await withTimeout(Promise.all(
      senders.map(async ([key, n]) => {
        const limit = dailyLimits[key] ?? 0;
        if (limit <= 0) return;
        const { data: used } = await admin.rpc('sends_in_window', { p_sent_from: n.phone, p_hours: 24 })
          .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS));
        dailyRemaining.set(key, Math.max(0, limit - Number(used ?? 0)));
      }),
    ), 'daily limit check');
    if (senders.every(([key]) => (dailyLimits[key] ?? 0) > 0 && (dailyRemaining.get(key) ?? 0) <= 0)) {
      // Not a job failure — every number's cap resets at midnight PKT, and
      // the next tick will simply find capacity again once it does.
      return json({ ok: true, jobId: job.id, skipped: true, reason: 'every configured number at its daily limit' });
    }

    const token = await withTimeout(zoomToken(), 'Zoom auth');
    for (const [, n] of senders) {
      await withTimeout(zoomUserId(n.email, token), 'Zoom user lookup');
    }

    const sent: string[] = [];
    const skipped: { leadId: string; reason: string }[] = [];
    const failed: { leadId: string; error: string }[] = [];
    const assignedCount = new Map<string, number>(senders.map(([key]) => [key, 0]));
    let rotation = 0;

    function hasCapacity(key: string): boolean {
      if ((dailyLimits[key] ?? 0) <= 0) return true;
      return (assignedCount.get(key) ?? 0) < (dailyRemaining.get(key) ?? 0);
    }

    function nextSender(): number {
      for (let i = 0; i < senders.length; i++) {
        const idx = (rotation + i) % senders.length;
        if (hasCapacity(senders[idx][0])) return idx;
      }
      return -1;
    }

    type Planned = {
      lead: NonNullable<(typeof leads)[number]>;
      key: string;
      from: { phone: string; email: string; label: string };
      message: string;
      to: string;
    };
    const planned: Planned[] = [];
    const skipItemUpdates: Promise<unknown>[] = [];

    function markSkipped(leadId: string, reason: string) {
      skipped.push({ leadId, reason });
      skipItemUpdates.push(
        admin.from('bulk_sms_job_items').update({ status: 'skipped', detail: reason, updated_at: nowIso() })
          .eq('job_id', job.id).eq('lead_id', leadId).abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
      );
    }

    for (const lead of leads) {
      if (lead.opted_out) { markSkipped(lead.id, 'opted out'); continue; }

      const to = toE164(lead.phone ?? '');
      if (!to) { markSkipped(lead.id, 'no usable phone number'); continue; }

      const tagNames: string[] = (lead.lead_tags ?? []).map((lt: any) => lt.tags?.name).filter(Boolean);
      const template = tagNames.map((n: string) => templatesByTag[n]).find(Boolean) ?? defaultTemplate;
      if (!template) { markSkipped(lead.id, 'no template for this lead\'s tags'); continue; }

      let key: string;
      let from: { phone: string; email: string; label: string };
      const pinned = lead.assigned_sms_number as string | null | undefined;
      const isPinned = isActiveKey(pinned) && senders.some(([k]) => k === pinned);

      if (isPinned) {
        if (!hasCapacity(pinned!)) { markSkipped(lead.id, 'assigned number has reached its daily limit'); continue; }
        key = pinned!;
        from = NUMBERS[pinned!];
      } else {
        const idx = nextSender();
        if (idx === -1) { markSkipped(lead.id, 'every configured number has reached its daily limit'); continue; }
        [key, from] = senders[idx];
        rotation = (idx + 1) % senders.length;
      }
      assignedCount.set(key, (assignedCount.get(key) ?? 0) + 1);

      const message = render(template, {
        first_name: lead.first_name, last_name: lead.last_name,
        address: lead.address, city: lead.city, state: lead.state, zip: lead.zip,
      });
      planned.push({ lead, key, from, message, to });
    }

    if (skipItemUpdates.length) await withTimeout(Promise.all(skipItemUpdates), 'recording skipped leads').catch(() => {});

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

        // Atomic claim — must stay byte-identical in intent to send-sms's
        // own copy of this guard (see that file for the full reasoning).
        // This exact statement is what makes it safe for this function and
        // send-sms to both be reachable for the same job at once.
        let claimed = false;
        try {
          const { data: claimRows } = await withTimeout(
            admin.from('bulk_sms_job_items').update({ status: 'sending', updated_at: nowIso() })
              .eq('job_id', job.id).eq('lead_id', lead.id).eq('status', 'queued')
              .select('id').abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
            'claim item before sending',
          );
          claimed = !!claimRows?.length;
        } catch {
          claimed = false;
        }
        if (!claimed) {
          skipped.push({ leadId: lead.id, reason: 'already claimed by another process — no duplicate text sent' });
          continue;
        }

        try {
          await withTimeout(sendZoomSms(from.phone, to, message, token), 'Zoom send');

          const leadUpdates: Record<string, unknown> = {};
          if (lead.stage === 'new') leadUpdates.stage = 'contacted';
          if (lead.assigned_sms_number !== key) leadUpdates.assigned_sms_number = key;

          await withTimeout(Promise.all([
            admin.from('send_log').insert({
              user_id: job.user_id,
              lead_id: lead.id, phone: to, phone_norm: lead.phone_norm, sent_from: from.phone, body: message,
            }).abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
            Object.keys(leadUpdates).length > 0
              ? admin.from('leads').update(leadUpdates).eq('id', lead.id).abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS))
              : Promise.resolve(null),
            admin.from('lead_activities').insert({
              lead_id: lead.id, user_id: job.user_id, type: 'sms', body: message,
              meta: { direction: 'outbound', from: from.phone, to, label: from.label },
            }).abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
          ]), 'recording the send').catch(() => {});

          sent.push(lead.id);

          await withTimeout(
            admin.from('bulk_sms_job_items').update({ status: 'sent', sent_from: from.phone, updated_at: nowIso() })
              .eq('job_id', job.id).eq('lead_id', lead.id).abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
            'mark item sent',
          ).catch(() => {});
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          failed.push({ leadId: lead.id, error: errMsg });
          await withTimeout(
            admin.from('bulk_sms_job_items').update({ status: 'failed', detail: errMsg.slice(0, 500), updated_at: nowIso() })
              .eq('job_id', job.id).eq('lead_id', lead.id).abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
            'mark item failed',
          ).catch(() => {});
        }

        if (perMessageDelayMs > 0 && i < items.length - 1) await sleep(perMessageDelayMs);
      }
    }

    await Promise.all(Array.from(groups.entries()).map(([key, items]) => processGroup(key, items)));

    // Same completion check as send-sms's own — only flips 'completed' once
    // nothing is left queued/sending for the job, so this batch finishing
    // doesn't prematurely close out a job with more still to go.
    const { count: remaining } = await withTimeout(
      admin.from('bulk_sms_job_items').select('id', { count: 'exact', head: true }).eq('job_id', job.id)
        .in('status', ['queued', 'sending']).abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
      'checking remaining items',
    );
    if (!remaining) {
      await withTimeout(
        admin.from('bulk_sms_jobs').update({ status: 'completed', completed_at: nowIso(), updated_at: nowIso() }).eq('id', job.id)
          .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS)),
        'mark job completed',
      );
    }

    return json({ ok: true, jobId: job.id, claimed: leadIds.length, sent: sent.length, skipped, failed });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: message }, 500);
  }
});
