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

/**
 * Calls the send-sms edge function. The window check, opt-out check and
 * rolling-limit check all happen server-side — this is a thin wrapper, not
 * where any of those rules live.
 */
export function useSendBulkSms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BulkSmsInput) => {
      const { data, error } = await supabase.functions.invoke<BulkSmsResult>('send-sms', { body: input });
      if (error) {
        const body = await error.context?.json?.().catch(() => null);
        throw new Error(body?.error || error.message);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as BulkSmsResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

// ── Bulk SMS jobs — the live queue behind the Bulk SMS page ────────────────

function dbToBulkSmsJob(row: any): BulkSmsJob {
  return { id: row.id, status: row.status, error: row.error, total: row.total, createdAt: row.created_at };
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

/**
 * Creates the job row and one queued item per lead before send-sms is ever
 * called, so the Bulk SMS page has something to show — and something to
 * navigate to — the instant the send starts, not once it finishes.
 */
export function useCreateBulkSmsJob() {
  const { profile } = useAuth();
  return useMutation({
    mutationFn: async (leads: Lead[]) => {
      if (!profile?.id) throw new Error('Not signed in.');
      const { data: job, error: jobErr } = await supabase
        .from('bulk_sms_jobs')
        .insert({ user_id: profile.id, status: 'running', total: leads.length })
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

export function useBulkSmsJobItems(jobId: string | undefined, jobStatus: string | undefined) {
  return useQuery({
    queryKey: ['bulk_sms_job_items', jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bulk_sms_job_items')
        .select('*')
        .eq('job_id', jobId!)
        .order('updated_at', { ascending: true });
      if (error) throw error;
      return (data ?? []).map(dbToBulkSmsJobItem);
    },
    enabled: !!jobId,
    refetchInterval: jobStatus === 'running' ? 1500 : false,
  });
}
