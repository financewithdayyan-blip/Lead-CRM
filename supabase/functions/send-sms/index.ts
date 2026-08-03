// Edge Function: send-sms
//
// Bulk cold outreach over Zoom Phone. Admin-only.
//
// The sending window, the rolling limits and the opt-out check all live here
// rather than in the client, because the client can be bypassed and none of
// these are cosmetic — sending outside the window or to an opted-out number is
// a compliance problem, not a UX one.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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
 * Applies to cold outreach only. AI auto-replies answer whenever the lead
 * writes, since replying to someone who just texted you is not cold contact.
 */
export function withinSendWindow(now = new Date()): boolean {
  const utcHour = now.getUTCHours();
  // 14:00-23:59 UTC, or 00:00-00:59 UTC (the window crosses midnight UTC).
  return utcHour >= 14 || utcHour < 1;
}

// ── Zoom auth ───────────────────────────────────────────────────────────────

// Cached for the life of the instance. Zoom tokens last an hour; re-minting one
// per message would be both slow and needlessly rate-limited.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function zoomToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;

  const basic = btoa(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`);
  const res = await fetch(
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

  const res = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Zoom user lookup failed for ${email} (${res.status}): ${await res.text()}`);

  const data = await res.json();
  userIdCache.set(email, data.id);
  return data.id;
}

async function sendZoomSms(fromPhone: string, toPhone: string, message: string, token: string) {
  const res = await fetch('https://api.zoom.us/v2/phone/sms/messages', {
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
      await admin.from('bulk_sms_jobs').update({ status: 'failed', error: message, updated_at: nowIso() }).eq('id', jobId);
    }
    return json({ error: message }, status);
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';

    // Identify the caller and require admin.
    const { data: userData } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
    const userId = userData?.user?.id;
    if (!userId) return json({ error: 'Not signed in.' }, 401);

    const { data: profile } = await admin.from('profiles').select('role').eq('id', userId).single();
    if (profile?.role !== 'admin') return json({ error: 'Admins only.' }, 403);

    const body = await req.json();
    const {
      leadIds = [],
      templatesByTag = {},
      defaultTemplate = '',
      fromKey = '1',
      perMessageDelayMs = 500,
      dailyLimit = 0,
      jobId: jobIdIn,
    } = body as {
      leadIds: string[];
      templatesByTag: Record<string, string>;
      defaultTemplate: string;
      fromKey: string;
      perMessageDelayMs?: number;
      dailyLimit?: number;
      jobId?: string;
    };
    jobId = jobIdIn;

    if (!leadIds.length) return bail('No leads selected.', 400);

    // Tag names, and any number a lead is already pinned to from a prior
    // send, come along so both the per-lead template and the sender choice
    // below can use them — moved ahead of the sender logic because a single
    // send now needs to know the pin before it can pick a number at all.
    const { data: leadsById, error: leadErr } = await admin
      .from('leads')
      .select(
        'id, first_name, last_name, phone, phone_norm, address, city, state, zip, opted_out, stage, assigned_sms_number, lead_tags(tag_id, tags(name))',
      )
      .in('id', leadIds);
    if (leadErr) throw leadErr;

    // Preserve the caller's own ordering rather than whatever order Postgres
    // happens to return, so the round-robin split below is deterministic.
    const byId = new Map((leadsById ?? []).map((l) => [l.id, l]));
    const leads = leadIds.map((id) => byId.get(id)).filter((l): l is NonNullable<typeof l> => !!l);

    function isActiveKey(key: string | null | undefined): key is string {
      return !!key && !!NUMBERS[key]?.phone && !!NUMBERS[key]?.email;
    }

    // Bulk (more than one lead) auto-splits evenly across every configured
    // number, switching to the next once a number's share — or its own
    // rolling 24h cap — is reached (individual leads already pinned to a
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

    // Each number's own remaining rolling-24h capacity, checked once up
    // front. A number already at its cap is simply skipped by the rotation
    // below rather than blocking the whole run.
    const dailyRemaining = new Map<string, number>();
    if (dailyLimit > 0) {
      await Promise.all(
        senders.map(async ([key, n]) => {
          const { data: used } = await admin.rpc('sends_in_window', { p_sent_from: n.phone, p_hours: 24 });
          dailyRemaining.set(key, Math.max(0, dailyLimit - Number(used ?? 0)));
        }),
      );
      if (senders.every(([key]) => (dailyRemaining.get(key) ?? 0) <= 0)) {
        return bail(`Every configured number has already reached the rolling 24h limit (${dailyLimit}).`, 422);
      }
    }

    const token = await zoomToken();
    // Resolved even though the send endpoint takes the number, because Zoom
    // rejects sends from a number the authed user doesn't own.
    await Promise.all(senders.map(([, n]) => zoomUserId(n.email, token)));

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

    // Equal target share per number, rounded up — the trailing number simply
    // absorbs whatever's left once the queue runs out. senderIndex only ever
    // moves forward: once a number's share or its own daily cap is hit, the
    // rotation advances and never returns to it.
    const targetPerNumber = Math.ceil(leadIds.length / senders.length);
    let senderIndex = 0;
    let sentTowardTarget = 0;

    function hasCapacity(key: string): boolean {
      if (dailyLimit <= 0) return true;
      return (assignedCount.get(key) ?? 0) < (dailyRemaining.get(key) ?? 0);
    }

    function advance() {
      while (
        senderIndex < senders.length &&
        (sentTowardTarget >= targetPerNumber || !hasCapacity(senders[senderIndex][0]))
      ) {
        senderIndex++;
        sentTowardTarget = 0;
      }
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
            .eq('job_id', jobId).eq('lead_id', leadId),
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
      // outside the round-robin state entirely — it neither advances
      // senderIndex nor counts toward any number's target share.
      let key: string;
      let from: { phone: string; email: string; label: string };
      const pinned = lead.assigned_sms_number as string | null | undefined;
      const isPinned = leadIds.length > 1 && isActiveKey(pinned) && senders.some(([k]) => k === pinned);

      if (isPinned) {
        if (dailyLimit > 0 && !hasCapacity(pinned!)) {
          markSkipped(lead.id, 'assigned number has reached its rolling 24h limit');
          continue;
        }
        key = pinned!;
        from = NUMBERS[pinned!];
      } else {
        advance();
        if (senderIndex >= senders.length) {
          markSkipped(lead.id, 'every configured number has reached its rolling 24h limit');
          continue;
        }
        [key, from] = senders[senderIndex];
        sentTowardTarget++;
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

    if (skipItemUpdates.length) await Promise.all(skipItemUpdates);

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

        if (jobId) {
          await admin.from('bulk_sms_job_items').update({ status: 'sending', updated_at: nowIso() })
            .eq('job_id', jobId).eq('lead_id', lead.id);
        }

        try {
          await sendZoomSms(from.phone, to, message, token);

          // Cold leads advance to Contacted. Anything further along keeps its
          // stage — a lead already in Negotiation shouldn't regress. The
          // first time a lead is ever sent to, the number it went out from
          // becomes its permanent home for every send after this one.
          const leadUpdates: Record<string, unknown> = {};
          if (lead.stage === 'new') leadUpdates.stage = 'contacted';
          if (lead.assigned_sms_number !== key) leadUpdates.assigned_sms_number = key;

          // These three writes are independent of each other, so they run
          // together rather than one-after-another — the send_log row is
          // still guaranteed to exist before the function can return success,
          // just no longer at the cost of three serial round trips.
          await Promise.all([
            admin.from('send_log').insert({
              user_id: userId,
              lead_id: lead.id,
              phone: to,
              phone_norm: lead.phone_norm,
              sent_from: from.phone,
              body: message,
            }),
            Object.keys(leadUpdates).length > 0
              ? admin.from('leads').update(leadUpdates).eq('id', lead.id)
              : Promise.resolve(null),
            admin.from('lead_activities').insert({
              lead_id: lead.id,
              user_id: userId,
              type: 'sms',
              body: message,
              meta: { direction: 'outbound', from: from.phone, to, label: from.label },
            }),
          ]);

          sent.push(lead.id);
          sentByNumber.set(key, (sentByNumber.get(key) ?? 0) + 1);

          if (jobId) {
            await admin.from('bulk_sms_job_items').update({ status: 'sent', sent_from: from.phone, updated_at: nowIso() })
              .eq('job_id', jobId).eq('lead_id', lead.id);
          }
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          failed.push({ leadId: lead.id, error: errMsg });
          if (jobId) {
            await admin.from('bulk_sms_job_items').update({ status: 'failed', detail: errMsg.slice(0, 500), updated_at: nowIso() })
              .eq('job_id', jobId).eq('lead_id', lead.id);
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

    if (jobId) {
      await admin.from('bulk_sms_jobs').update({ status: 'completed', updated_at: nowIso() }).eq('id', jobId);
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
      await admin.from('bulk_sms_jobs').update({ status: 'failed', error: message, updated_at: nowIso() }).eq('id', jobId).catch(() => {});
    }
    return json({ error: message }, 500);
  }
});
