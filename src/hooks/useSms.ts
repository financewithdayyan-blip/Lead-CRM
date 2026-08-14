import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { BulkSmsItemStatus, BulkSmsJob, BulkSmsJobItem, Lead } from '@/types/domain';
import type { SmsNumberKey } from '@/lib/smsNumbers';

/** The shape a bulk send is configured with — saved verbatim as
 * bulk_sms_jobs.config (see useCreateBulkSmsJob/BulkSmsConfig below) and
 * read back from there by bulk-sms-dispatcher on every tick. There's no
 * client-side "fire this chunk" call anymore — see that function's own
 * comments for why sending moved server-side, and supabase/functions/send-sms
 * for the one thing that still calls this shape directly (a manual reply
 * from the thread view, which never sets jobId). */
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
 * Stops a running send — bulk-sms-dispatcher only ever selects jobs with
 * status='running' (see supabase/functions/bulk-sms-dispatcher), so once
 * this lands, its next tick simply stops finding this job; a batch already
 * mid-send that tick still finishes rather than being cut off. Routed
 * through a narrow RPC rather than a direct update, since bulk_sms_jobs has
 * no client-side UPDATE policy at all — this is the one specific exception,
 * and it can only ever move running->paused.
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
 * Picks a stalled, failed, or paused job back up. bulk-sms-dispatcher (the
 * pg_cron-driven worker, see supabase/functions/bulk-sms-dispatcher) is the
 * only thing that ever actually selects a batch and sends it — this just
 * flips the job back to 'running' via a narrow RPC (bulk_sms_jobs has no
 * client-side UPDATE policy, same reasoning as usePauseBulkSmsJob above) so
 * the dispatcher's next tick (within about a minute) picks it back up on
 * its own, using the same message/settings it was started with.
 */
export function useResumeBulkSmsJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase.rpc('resume_bulk_sms_job', { p_job_id: jobId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bulk_sms_job'] });
      qc.invalidateQueries({ queryKey: ['bulk_sms_jobs'] });
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
