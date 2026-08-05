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
  dailyLimit?: number;
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
const BULK_CHUNK_SIZE = 100;

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

  for (const chunk of chunks) {
    const { data, error } = await supabase.functions.invoke<BulkSmsResult>('send-sms', {
      body: { ...rest, leadIds: chunk },
    });
    if (error) {
      const body = await error.context?.json?.().catch(() => null);
      throw new Error(body?.error || error.message);
    }
    if ((data as any)?.error) throw new Error((data as any).error);
    const result = data as BulkSmsResult;
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
 * Picks a stalled or failed job back up — only the leads still sitting at
 * 'queued' for it, using the same message/settings it was started with, so
 * retrying never re-texts someone who already got a message. Requires the
 * job to have a saved config (see useCreateBulkSmsJob); older jobs from
 * before that existed can't be auto-resumed.
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
