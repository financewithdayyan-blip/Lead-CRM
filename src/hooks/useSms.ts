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
  /** Required for a one-off, non-job call (a single manual send). A
   * job-tracked call omits this entirely — send-sms works whatever's
   * 'queued' for the job directly, so the caller never needs to know or
   * track which leads those are. */
  leadIds?: string[];
  templatesByTag?: Record<string, string>;
  defaultTemplate?: string;
  /** Only used when leadIds has exactly one entry — a bulk send ignores this
   * and auto-splits across every configured number instead. */
  fromKey?: SmsNumberKey;
  perMessageDelayMs?: number;
  /** Per-number rolling 24h cap, keyed '1'-'4'. Missing or 0 for a key means
   * unlimited for that number. */
  dailyLimits?: Record<string, number>;
  /** When set, send-sms writes live per-lead progress to bulk_sms_job_items
   * as it works, and self-continues in the background until the whole job
   * is done — the caller only ever needs to fire this once. */
  jobId?: string;
}

/**
 * Kicks off a bulk send. A job-tracked call (the normal Bulk SMS page path)
 * only ever needs to fire the first chunk — send-sms hands itself the rest
 * in the background once this call returns (see its own note on
 * EdgeRuntime.waitUntil), so this resolves after the first ~100 leads, not
 * the whole job, and keeps running server-side regardless of whether this
 * tab stays open. A non-job call (a single manual send) still goes through
 * in one shot, same as always.
 */
async function invokeSendSms(input: BulkSmsInput): Promise<BulkSmsResult> {
  const { data, error } = await supabase.functions.invoke<BulkSmsResult>('send-sms', {
    body: input.jobId ? { jobId: input.jobId } : input,
  });
  if (error) {
    const body = await error.context?.json?.().catch(() => null);
    throw new Error(body?.error || error.message);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as BulkSmsResult;
}

export function useSendBulkSms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: invokeSendSms,
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
      const { data, error } = await supabase
        .from('bulk_sms_jobs')
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
 * Picks a stalled, failed, or paused job back up. send-sms reads the job's
 * saved config and works whatever's still 'queued' for it directly — this
 * just kicks that off and lets its own self-chaining take it the rest of
 * the way, so retrying never re-texts someone who already got a message.
 * Requires the job to have a saved config (see useCreateBulkSmsJob); older
 * jobs from before that existed can't be auto-resumed.
 */
export function useResumeBulkSmsJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => {
      const { data: job, error: jobErr } = await supabase.from('bulk_sms_jobs').select('config').eq('id', jobId).single();
      if (jobErr) throw jobErr;
      if (!job.config) {
        throw new Error(
          "This send started before Resume existed, so its message and settings weren't saved. Start a fresh send instead — leads already messaged from it have moved past the New stage, so they're safe to leave in your selection.",
        );
      }
      return invokeSendSms({ jobId });
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
