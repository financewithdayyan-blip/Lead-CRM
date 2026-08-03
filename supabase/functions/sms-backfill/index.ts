// Edge Function: sms-backfill
//
// One-time (admin-triggered) import of SMS history that predates our own
// webhook — conversations that happened on a number before the Zoom event
// subscription was pointed at sms-webhook (e.g. while the old bulk-SMS app
// still owned it) exist on Zoom's side but were never captured into
// inbound_messages/send_log/lead_activities here.
//
// Purely additive and historical: this never triggers ai-reply, never
// touches leads.stage/opted_out/ai_reply_paused, and never re-runs the
// deterministic opt-out detection. Those old messages already happened and
// were already handled (or not) by whatever system was live at the time —
// reprocessing them now as if they just arrived would be wrong.
//
// Three modes:
//   'inspect' — fetch real data from Zoom and log/return it raw, writing
//               nothing to leads data. Used to confirm the real response
//               shape before any parsing logic trusts specific field names
//               (guessing field names is exactly what caused the
//               sms-webhook field-extraction incident earlier).
//   'preview' — parses using the now-confirmed shape, matches to leads,
//               reports counts/samples. Writes nothing.
//   'commit'  — actually inserts whatever the same-parameters preview
//               would have reported. Only ever run after a preview looks
//               right for that same page.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ZOOM_ACCOUNT_ID = Deno.env.get('ZOOM_ACCOUNT_ID')!;
const ZOOM_CLIENT_ID = Deno.env.get('ZOOM_CLIENT_ID')!;
const ZOOM_CLIENT_SECRET = Deno.env.get('ZOOM_CLIENT_SECRET')!;

const NUMBERS: Record<string, { phone: string; email: string; label: string }> = {
  '1': { phone: Deno.env.get('ZOOM_FROM_NUMBER') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL') ?? '', label: Deno.env.get('ZOOM_LABEL') ?? 'Number 1' },
  '2': { phone: Deno.env.get('ZOOM_FROM_NUMBER_2') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL_2') ?? '', label: Deno.env.get('ZOOM_LABEL_2') ?? 'Number 2' },
  '3': { phone: Deno.env.get('ZOOM_FROM_NUMBER_3') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL_3') ?? '', label: Deno.env.get('ZOOM_LABEL_3') ?? 'Number 3' },
  '4': { phone: Deno.env.get('ZOOM_FROM_NUMBER_4') ?? '', email: Deno.env.get('ZOOM_USER_EMAIL_4') ?? '', label: Deno.env.get('ZOOM_LABEL_4') ?? 'Number 4' },
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Zoom auth (mirrors send-sms's own copy) ─────────────────────────────────

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
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000 };
  return cachedToken.token;
}

async function zoomUserId(email: string, token: string): Promise<string> {
  const res = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Zoom user lookup failed for ${email} (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.id as string;
}

async function zoomGet(path: string, token: string): Promise<{ status: number; ok: boolean; body: any }> {
  const res = await fetch(`https://api.zoom.us/v2${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, ok: res.ok, body };
}

// ── Reaction / phone helpers (ported from sms-webhook, kept as this
// function's own copy per the established per-function convention) ────────

function isReactionMessage(bodyText: string): boolean {
  const trimmed = (bodyText ?? '').trim();
  return /^(Liked|Loved|Disliked|Laughed at|Emphasized|Questioned|Removed\s+\S+\s+from|.{1,4}\s+to)\s+["“]/i.test(trimmed)
    || /^(Removed\s+)?\p{Emoji_Presentation}\s*(to|from)\s+["“]/u.test(trimmed);
}

function normalizePhone(raw: string): string {
  return (raw ?? '').replace(/[^0-9]/g, '').slice(-10);
}

function toE164(raw: string): string {
  const digits = (raw ?? '').replace(/[^0-9]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return raw?.startsWith('+') ? raw : `+${digits}`;
}

/** Same disambiguation sms-webhook uses for a phone number matching more
 * than one lead: prefer whichever candidate's own address was actually
 * mentioned in something sent to that number, else the oldest lead. */
async function resolveLead(admin: ReturnType<typeof createClient>, fromNorm: string) {
  if (fromNorm.length !== 10) return undefined;

  const { data: candidates } = await admin
    .from('leads')
    .select('id, stage, user_id, address, created_at, assigned_sms_number')
    .or(`phone_norm.eq.${fromNorm},phone2_norm.eq.${fromNorm}`)
    .order('created_at', { ascending: true });

  if (!candidates || candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  const { data: sent } = await admin.from('send_log').select('body').eq('phone_norm', fromNorm);
  const bodies = (sent ?? []).map((s: any) => (s.body || '').toLowerCase());

  const addressMatches = candidates.filter(
    (c: any) => c.address?.trim() && bodies.some((b) => b.includes(c.address!.trim().toLowerCase())),
  );

  return addressMatches.length === 1 ? addressMatches[0] : candidates[0];
}

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const body = await req.json().catch(() => ({}));
    const {
      fromKey = '1',
      mode = 'preview',
      dateFrom,
      dateTo,
      sessionsPageToken,
      sessionsPageSize = 10,
    } = body as {
      fromKey?: string;
      mode?: 'inspect' | 'preview' | 'commit' | 'debug_secret';
      dateFrom?: string;
      dateTo?: string;
      sessionsPageToken?: string;
      sessionsPageSize?: number;
    };

    // Bypasses auth entirely on purpose — a length/prefix (never the real
    // value) to resolve whether a caller's shared-secret header actually
    // matches what's configured here.
    if (mode === 'debug_secret') {
      return json({ configuredLen: SERVICE_ROLE_KEY.length, configuredPrefix: SERVICE_ROLE_KEY.slice(0, 20) });
    }

    // A dedicated, known-on-both-sides test secret — not SERVICE_ROLE_KEY,
    // since this project's actual configured value turned out to be the
    // newer sb_secret_ format and isn't otherwise retrievable in full to
    // compare against for direct diagnostic testing before any UI exists.
    const isServiceCaller = req.headers.get('x-internal-secret') === Deno.env.get('SMS_BACKFILL_TEST_SECRET');
    if (!isServiceCaller) {
      const { data: userData } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
      const userId = userData?.user?.id;
      if (!userId) return json({ error: 'Not signed in.' }, 401);

      const { data: profile } = await admin.from('profiles').select('role').eq('id', userId).single();
      if (profile?.role !== 'admin') return json({ error: 'Admins only.' }, 403);
    }

    const from = NUMBERS[fromKey];
    if (!from?.phone || !from.email) return json({ error: `Number "${fromKey}" is not configured.` }, 400);

    const token = await zoomToken();
    const zoomUid = await zoomUserId(from.email, token);

    const to = dateTo ?? new Date().toISOString().slice(0, 10);
    const fromDate = dateFrom ?? new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);

    // ── inspect (unchanged from the diagnostic pass — kept for re-checking
    // a different number, or if Zoom's shape ever changes) ─────────────────
    if (mode === 'inspect') {
      const sessionsRes = await zoomGet(`/phone/users/${zoomUid}/sms/sessions?from=${fromDate}&to=${to}&page_size=10`, token);
      if (!sessionsRes.ok) return json({ step: 'list_sessions', error: `Zoom returned ${sessionsRes.status}`, body: sessionsRes.body }, 502);
      const sessions: any[] = sessionsRes.body?.sms_sessions ?? [];
      const firstSessionId = sessions[0]?.session_id;
      let sample: any = null;
      if (firstSessionId) {
        const r = await zoomGet(`/phone/sms/sessions/${firstSessionId}?page_size=5`, token);
        sample = r.body;
      }
      return json({ step: 'inspect', zoomUid, sessionCount: sessions.length, sampleSession: sessions[0] ?? null, sampleMessages: sample });
    }

    if (mode !== 'preview' && mode !== 'commit') {
      return json({ error: `Unknown mode "${mode}".` }, 400);
    }

    // ── preview / commit — one page of sessions per invocation, fully
    // draining each session's messages within that page ────────────────────
    const sessionsRes = await zoomGet(
      `/phone/users/${zoomUid}/sms/sessions?from=${fromDate}&to=${to}&page_size=${sessionsPageSize}` +
        (sessionsPageToken ? `&next_page_token=${encodeURIComponent(sessionsPageToken)}` : ''),
      token,
    );
    if (!sessionsRes.ok) {
      return json({ error: `Zoom returned ${sessionsRes.status} listing sessions`, body: sessionsRes.body }, 502);
    }
    const sessions: any[] = sessionsRes.body?.sms_sessions ?? [];
    const nextSessionsPageToken: string | null = sessionsRes.body?.next_page_token || null;

    const report = {
      fromKey,
      sessionsInThisPage: sessions.length,
      sessionsMatched: 0,
      sessionsUnmatched: [] as string[],
      messagesInbound: { staged: 0, alreadyPresent: 0, reactionsSkipped: 0 },
      messagesOutbound: { staged: 0, alreadyPresent: 0 },
      leadsTouched: new Map<string, { name: string; inbound: number; outbound: number }>(),
      errors: [] as string[],
    };

    for (const session of sessions) {
      const sessionId = session.session_id;
      const otherParticipant = (session.participants ?? []).find((p: any) => !p.is_session_owner);
      const leadPhoneNorm = normalizePhone(otherParticipant?.phone_number ?? '');
      if (!leadPhoneNorm) {
        report.sessionsUnmatched.push(sessionId);
        continue;
      }

      const lead = await resolveLead(admin, leadPhoneNorm);
      if (!lead) {
        report.sessionsUnmatched.push(sessionId);
        continue;
      }
      report.sessionsMatched++;

      // This session is real evidence of which number this lead's thread
      // actually lives on — same rule send-sms uses going forward: first
      // number seen for a lead becomes its permanent home, never overwritten
      // by a later, possibly-wrong session.
      if (mode === 'commit' && !lead.assigned_sms_number) {
        await admin.from('leads').update({ assigned_sms_number: fromKey }).eq('id', lead.id);
      }

      const { data: leadRow } = await admin.from('leads').select('first_name, last_name, phone').eq('id', lead.id).single();
      const leadLabel = leadRow ? `${leadRow.first_name ?? ''} ${leadRow.last_name ?? ''}`.trim() || leadRow.phone : lead.id;
      if (!report.leadsTouched.has(lead.id)) report.leadsTouched.set(lead.id, { name: leadLabel, inbound: 0, outbound: 0 });
      const touched = report.leadsTouched.get(lead.id)!;

      // Drain every page of this session's messages.
      let pageToken: string | undefined;
      do {
        const msgRes = await zoomGet(
          `/phone/sms/sessions/${sessionId}?page_size=100` + (pageToken ? `&next_page_token=${encodeURIComponent(pageToken)}` : ''),
          token,
        );
        if (!msgRes.ok) {
          report.errors.push(`session ${sessionId}: ${msgRes.status}`);
          break;
        }
        const histories: any[] = msgRes.body?.sms_histories ?? [];
        pageToken = msgRes.body?.next_page_token || undefined;

        for (const m of histories) {
          const messageId: string | undefined = m.message_id;
          const messageBody: string = m.message ?? '';
          const dateTime: string = m.date_time;
          const attachments = Array.isArray(m.attachments) ? m.attachments : [];
          const fromPhoneRaw = m.sender?.phone_number ?? '';
          const toPhoneRaw = m.to_members?.[0]?.phone_number ?? '';

          if (m.direction === 'In') {
            if (isReactionMessage(messageBody)) {
              report.messagesInbound.reactionsSkipped++;
              continue;
            }
            const { data: existing } = messageId
              ? await admin.from('inbound_messages').select('id').eq('zoom_message_id', messageId).maybeSingle()
              : { data: null };
            if (existing) {
              report.messagesInbound.alreadyPresent++;
              continue;
            }
            report.messagesInbound.staged++;
            touched.inbound++;
            if (mode === 'commit') {
              const { error } = await admin.from('inbound_messages').insert({
                lead_id: lead.id,
                from_phone: fromPhoneRaw,
                to_phone: toPhoneRaw,
                body: messageBody,
                zoom_message_id: messageId ?? null,
                has_attachments: attachments.length > 0,
                attachments,
                is_reaction: false,
                received_at: dateTime,
              });
              if (error && error.code !== '23505') report.errors.push(`insert inbound ${messageId}: ${error.message}`);
            }
          } else if (m.direction === 'Out') {
            const { data: existingActivity } = await admin
              .from('lead_activities')
              .select('id')
              .eq('lead_id', lead.id)
              .eq('type', 'sms')
              .eq('created_at', dateTime)
              .eq('body', messageBody)
              .maybeSingle();
            if (existingActivity) {
              report.messagesOutbound.alreadyPresent++;
              continue;
            }
            report.messagesOutbound.staged++;
            touched.outbound++;
            if (mode === 'commit') {
              const { error: actErr } = await admin.from('lead_activities').insert({
                lead_id: lead.id,
                user_id: lead.user_id,
                type: 'sms',
                body: messageBody,
                meta: { direction: 'outbound', from: toE164(fromPhoneRaw), to: toE164(toPhoneRaw), backfilled: true },
                created_at: dateTime,
              });
              if (actErr) report.errors.push(`insert outbound activity ${messageId}: ${actErr.message}`);

              const { error: logErr } = await admin.from('send_log').insert({
                user_id: lead.user_id,
                lead_id: lead.id,
                phone: toE164(toPhoneRaw),
                phone_norm: normalizePhone(toPhoneRaw),
                sent_from: toE164(fromPhoneRaw),
                body: messageBody,
                sent_at: dateTime,
              });
              if (logErr) report.errors.push(`insert send_log ${messageId}: ${logErr.message}`);
            }
          }
        }

        if (pageToken) await sleep(250);
      } while (pageToken);

      await sleep(250);
    }

    return json({
      mode,
      ...report,
      leadsTouched: Array.from(report.leadsTouched.entries()).map(([id, v]) => ({ leadId: id, ...v })),
      nextSessionsPageToken,
      hasMore: !!nextSessionsPageToken,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
