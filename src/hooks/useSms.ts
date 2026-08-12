import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { BulkSmsItemStatus, BulkSmsJob, BulkSmsJobItem, Lead } from '@/types/domain';
import type { SmsNumberKey } from '@/lib/smsNumbers';

export interface BulkSmsResult {
  sent: number;
  skipped: { leadId: string; reason: string }[];
  failed: { leadId: string; error: string }[];
  /** How the send split across numbers. More than one lead auto-splits
   * across every configured number; a single lead uses just the one picked. */
  perNumber: { key: string; label: string; sent: number }[];
}

export interface BulkSmsInput {
  leadIds: string[];
  templatesByTag: Record<string, string>;
  defaultTemplate: string;
  /** Only used when leadIds has exactly one entry — a bulk send ignores this
   * and auto-splits across every configured number instead. */
  fromKey: SmsNumberKey;
  perMessageDelayMs?: number;
  /** Per-number rolling 24h cap, keyed '1'-'4'. Missing or 0 for a key means
   * unlimited for that number. */
  dailyLimits?: Record<string, number>;
  /** When set, send-sms writes live per-lead progress to bulk_sms_job_items
   * as it works, instead of only returning a final summary at the end. */
  jobId?: string;
}

// A single invocation processing a big batch can run long enough to hit the
// edge function platform's execution-time limit and get killed mid-batch,
// leaving the job stuck 'running' forever with no error — this happened
// repeatedly on 1000+ lead sends (one measured run got cut off at ~152s after
// only 238 of 1441 leads). Splitting into smaller sequential invocations
// keeps each one comfortably short; send-sms itself only marks the job
// 'completed' once nothing is left queued across every chunk, so this is
// invisible to the caller beyond taking a few extra round trips.
//
// (A server-side self-chaining version of this was tried on 2026-08-10 to
// survive a closed tab entirely, but caused a real stuck-send incident —
// reverted back to this proven client-driven loop. The admin just needs to
// keep the tab open, or click Resume, for a large send.)
const BULK_CHUNK_SIZE = 100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A chunk invocation occasionally hangs badly enough on Zoom's side that no
// timeout inside send-sms catches it — that only covers work happening once
// the function is actually running, not a connection that never gets a
// response at all. Observed for real on 2026-08-12: 9+ minutes of total
// silence, zero leads even reaching "sending," until the admin noticed and
// manually clicked Stop then Resume. CLIENT_TIMEOUT_MS turns that into a
// fast, visible failure instead of an unbounded hang; the retry below goes
// one step further and recovers from it automatically — the whole point
// being to actually finish the send, not require a human watching for it.
//
// Retrying is only safe against leads still genuinely 'queued': send-sms
// keeps running server-side even after the client gives up waiting on it
// (confirmed for real — job items kept advancing after this exact kind of
// timeout), so blindly resending the same chunk risks a second text to
// anyone the orphaned invocation is still mid-send to. Waiting SETTLE_MS
// after a timeout before re-checking gives that orphaned run a real chance
// to either finish or get killed by the platform's own execution ceiling;
// only leads still 'queued' after that — never touched, or the platform did
// kill it before reaching them — get resent.
const CLIENT_TIMEOUT_MS = 150_000;
const SETTLE_MS = 60_000;
const MAX_CHUNK_RETRIES = 2;

async function sendChunkWithRetry(leadIds: string[], rest: Omit<BulkSmsInput, 'leadIds'>): Promise<BulkSmsResult> {
  let remaining = leadIds;
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await supabase.functions.invoke<BulkSmsResult>('send-sms', {
      body: { ...rest, leadIds: remaining },
      timeout: CLIENT_TIMEOUT_MS,
    });
    if (!error) {
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as BulkSmsResult;
    }
    // FunctionsFetchError means the request itself never got a response —
    // our own timeout above, or a real network drop — as opposed to
    // FunctionsHttpError (send-sms actually ran and returned a real error,
    // already recorded on the job, nothing ambiguous to wait out) or
    // FunctionsRelayError. Only the "might still be running" case gets the
    // settle-and-retry treatment.
    const isHang = error.name === 'FunctionsFetchError';
    if (!isHang || attempt >= MAX_CHUNK_RETRIES || !rest.jobId) {
      const body = await error.context?.json?.().catch(() => null);
      throw new Error(body?.error || error.message);
    }
    await sleep(SETTLE_MS);
    const { data: stillQueued } = await supabase
      .from('bulk_sms_job_items')
      .select('lead_id')
      .eq('job_id', rest.jobId)
      .eq('status', 'queued')
      .in('lead_id', remaining);
    remaining = (stillQueued ?? []).map((r) => r.lead_id as string);
    // Nothing left queued — the orphaned run actually finished this batch
    // on its own while we were waiting it out.
    if (!remaining.length) return { sent: 0, skipped: [], failed: [], perNumber: [] };
  }
}

/**
 * Calls the send-sms edge function, one chunk of leads at a time. The window
 * check, opt-out check and rolling-limit check all happen server-side — this
 * is just the chunking wrapper, not where any of those rules live. Shared by
 * useSendBulkSms (a fresh send) and useResumeBulkSmsJob (only the leads a
 * stalled job never got to).
 */
async function sendBulkSmsChunked(input: BulkSmsInput): Promise<BulkSmsResult> {
  const { leadIds, ...rest } = input;
  const chunks: string[][] = [];
  for (let i = 0; i < leadIds.length; i += BULK_CHUNK_SIZE) chunks.push(leadIds.slice(i, i + BULK_CHUNK_SIZE));
  if (!chunks.length) chunks.push([]);

  const merged: BulkSmsResult = { sent: 0, skipped: [], failed: [], perNumber: [] };
  const perNumberByKey = new Map<string, { key: string; label: string; sent: number }>();

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    // Checked between chunks, not mid-chunk — a chunk already in flight
    // finishes (up to 100 leads), but no further one gets dispatched once
    // an admin hits Stop. Cheap enough to check every time since each chunk
    // itself takes tens of seconds.
    //
    // Skipped for the very first chunk: a Resume call's job is *currently*
    // sitting at 'paused' by definition (that's the only way the Resume
    // button shows up at all) — checking before chunk 0 too meant this loop
    // saw its own starting state, bailed out immediately, and silently did
    // nothing at all. send-sms itself flips the row to 'running' as its
    // first real step, so from chunk 1 onward this correctly reflects a
    // Stop click made *during* the run instead of the job's state before it.
    if (rest.jobId && chunkIndex > 0) {
      const { data: jobRow } = await supabase.from('bulk_sms_jobs').select('status').eq('id', rest.jobId).single();
      if (jobRow?.status === 'paused') break;
    }
    const result = await sendChunkWithRetry(chunk, rest);
    merged.sent += result.sent;
    merged.skipped.push(...result.skipped);
    merged.failed.push(...result.failed);
    for (const pn of result.perNumber) {
      const existing = perNumberByKey.get(pn.key);
      if (existing) existing.sent += pn.sent;
      else perNumberByKey.set(pn.key, { ...pn });
    }
  }
  merged.perNumber = Array.from(perNumberByKey.values());
  return merged;
}

export function useSendBulkSms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: sendBulkSmsChunked,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

// ── Bulk SMS jobs — the live queue behind the Bulk SMS page ────────────────

function dbToBulkSmsJob(row: any): BulkSmsJob {
  return {
    id: row.id,
    status: row.status,
    error: row.error,
    total: row.total,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? null,
    hasConfig: !!row.config,
    // Only present on rows from bulk_sms_jobs_with_counts (useBulkSmsJobs).
    sentCount: row.sent_count != null ? Number(row.sent_count) : undefined,
    skippedCount: row.skipped_count != null ? Number(row.skipped_count) : undefined,
    failedCount: row.failed_count != null ? Number(row.failed_count) : undefined,
  };
}

function dbToBulkSmsJobItem(row: any): BulkSmsJobItem {
  return {
    id: row.id,
    leadId: row.lead_id,
    leadName: row.lead_name,
    status: row.status as BulkSmsItemStatus,
    sentFrom: row.sent_from,
    detail: row.detail,
    updatedAt: row.updated_at,
  };
}

/** What a send was started with — saved on the job row so a stalled run can
 * be resumed later without the admin retyping the message. */
export type BulkSmsConfig = Omit<BulkSmsInput, 'leadIds' | 'jobId'>;

/**
 * Creates the job row and one queued item per lead before send-sms is ever
 * called, so the Bulk SMS page has something to show — and something to
 * navigate to — the instant the send starts, not once it finishes.
 */
export function useCreateBulkSmsJob() {
  const { profile } = useAuth();
  return useMutation({
    mutationFn: async ({ leads, config }: { leads: Lead[]; config: BulkSmsConfig }) => {
      if (!profile?.id) throw new Error('Not signed in.');
      const { data: job, error: jobErr } = await supabase
        .from('bulk_sms_jobs')
        .insert({ user_id: profile.id, status: 'running', total: leads.length, config })
        .select()
        .single();
      if (jobErr) throw jobErr;

      if (leads.length) {
        const { error: itemsErr } = await supabase.from('bulk_sms_job_items').insert(
          leads.map((l) => ({
            job_id: job.id,
            lead_id: l.id,
            lead_name: `${l.firstName} ${l.lastName}`.trim() || l.phone,
            status: 'queued',
          })),
        );
        if (itemsErr) throw itemsErr;
      }

      return dbToBulkSmsJob(job);
    },
  });
}

/** Polls while the job is still running — a bulk send is a background
 * process on the server, so there's no push event to react to instead. */
export function useBulkSmsJob(jobId: string | undefined) {
  return useQuery({
    queryKey: ['bulk_sms_job', jobId],
    queryFn: async () => {
      const { data, error } = await supabase.from('bulk_sms_jobs').select('*').eq('id', jobId!).single();
      if (error) throw error;
      return dbToBulkSmsJob(data);
    },
    enabled: !!jobId,
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 1500 : false),
  });
}

/** Recent jobs for the Bulk SMS landing page — the sidebar link has to open
 * onto something even with no jobId in hand yet. */
export function useBulkSmsJobs() {
  return useQuery({
    queryKey: ['bulk_sms_jobs'],
    queryFn: async () => {
      // The view (not the bare table) so each row comes back with its own
      // sent/skipped/failed counts already aggregated, instead of an N+1
      // count query per row in the history table.
      const { data, error } = await supabase
        .from('bulk_sms_jobs_with_counts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []).map(dbToBulkSmsJob);
    },
  });
}

/** Removes a job from the All Sends list — bulk_sms_job_items cascades on
 * delete, so its per-lead rows go with it. Doesn't touch any lead or SMS
 * that already went out, just the history record of the send itself. */
export function useDeleteBulkSmsJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase.from('bulk_sms_jobs').delete().eq('id', jobId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bulk_sms_jobs'] }),
  });
}

const ITEMS_PAGE_SIZE = 1000;

export function useBulkSmsJobItems(jobId: string | undefined, jobStatus: string | undefined) {
  return useQuery({
    queryKey: ['bulk_sms_job_items', jobId],
    queryFn: async () => {
      // PostgREST caps an unpaginated select at 1000 rows — a batch bigger
      // than that (bulk sends regularly run 1000+ leads) would silently come
      // back truncated, so the live counts stall short of the real total.
      // Page through with .range() until a page comes back short. Ordered by
      // id (stable) rather than updated_at — rows are actively being updated
      // by send-sms while this loop runs, so sorting by a mutating column
      // could shift a row between pages mid-fetch and drop or double it.
      const rows: any[] = [];
      for (let from = 0; ; from += ITEMS_PAGE_SIZE) {
        const { data, error } = await supabase
          .from('bulk_sms_job_items')
          .select('*')
          .eq('job_id', jobId!)
          .order('id', { ascending: true })
          .range(from, from + ITEMS_PAGE_SIZE - 1);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < ITEMS_PAGE_SIZE) break;
      }
      rows.sort((a, b) => (a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : 0));
      return rows.map(dbToBulkSmsJobItem);
    },
    enabled: !!jobId,
    refetchInterval: jobStatus === 'running' ? 1500 : false,
  });
}

/**
 * Stops a running send between chunks — the client-side loop in
 * sendBulkSmsChunked checks for this and stops dispatching further batches,
 * so a chunk already in flight (up to 100 leads) still finishes rather than
 * being cut off mid-batch. Routed through a narrow RPC rather than a direct
 * update, since bulk_sms_jobs has no client-side UPDATE policy at all — this
 * is the one specific exception, and it can only ever move running->paused.
 */
export function usePauseBulkSmsJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase.rpc('pause_bulk_sms_job', { p_job_id: jobId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bulk_sms_job'] });
      qc.invalidateQueries({ queryKey: ['bulk_sms_jobs'] });
    },
  });
}

/**
 * Picks a stalled, failed, or paused job back up — only the leads still
 * sitting at 'queued' for it, using the same message/settings it was
 * started with, so retrying never re-texts someone who already got a
 * message. Requires the job to have a saved config (see
 * useCreateBulkSmsJob); older jobs from before that existed can't be
 * auto-resumed.
 */
export function useResumeBulkSmsJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => {
      const { data: job, error: jobErr } = await supabase.from('bulk_sms_jobs').select('*').eq('id', jobId).single();
      if (jobErr) throw jobErr;
      if (!job.config) {
        throw new Error(
          "This send started before Resume existed, so its message and settings weren't saved. Start a fresh send instead — leads already messaged from it have moved past the New stage, so they're safe to leave in your selection.",
        );
      }

      const leadIds: string[] = [];
      for (let from = 0; ; from += ITEMS_PAGE_SIZE) {
        const { data, error } = await supabase
          .from('bulk_sms_job_items')
          .select('lead_id')
          .eq('job_id', jobId)
          .eq('status', 'queued')
          .order('id', { ascending: true })
          .range(from, from + ITEMS_PAGE_SIZE - 1);
        if (error) throw error;
        leadIds.push(...(data ?? []).map((r) => r.lead_id).filter((id): id is string => !!id));
        if (!data || data.length < ITEMS_PAGE_SIZE) break;
      }
      if (!leadIds.length) throw new Error('Nothing left to resume — every lead in this job already has an outcome.');

      return sendBulkSmsChunked({ ...(job.config as BulkSmsConfig), leadIds, jobId });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['activities'] });
      qc.invalidateQueries({ queryKey: ['bulk_sms_job'] });
      qc.invalidateQueries({ queryKey: ['bulk_sms_job_items'] });
    },
  });
}

export interface SendRemindersResult {
  sent: number;
  rescheduled: number;
  promoted: number;
  declined: number;
  skipped: number;
  totalEligible: number;
  errors: { leadId: string; error: string }[];
}

/** Runs the same daily reminder sweep the cron job runs on its own schedule
 * — for every lead in Replied or Partial-Qualified due for a nudge right
 * now, drafts and sends a check-in about whatever's still outstanding, or
 * reschedules quietly if they've already promised a specific day. */
export function useSendReminders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<SendRemindersResult>('send-reminders', { body: {} });
      if (error) {
        const body = await error.context?.json?.().catch(() => null);
        throw new Error(body?.error || error.message);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as SendRemindersResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}
