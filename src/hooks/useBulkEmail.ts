import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { BulkEmailItemStatus, BulkEmailJob, BulkEmailJobItem, Lead } from '@/types/domain';

/** Saved verbatim as bulk_email_jobs.config, read back from there once the
 * dispatcher exists. No per-tag overrides or fromKey, unlike SMS — one
 * sending identity, one subject/body per send. */
export interface BulkEmailConfig {
  subject: string;
  body: string;
}

function dbToBulkEmailJob(row: any): BulkEmailJob {
  return {
    id: row.id,
    status: row.status,
    error: row.error,
    total: row.total,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? null,
    hasConfig: !!row.config,
    sentCount: row.sent_count != null ? Number(row.sent_count) : undefined,
    skippedCount: row.skipped_count != null ? Number(row.skipped_count) : undefined,
    failedCount: row.failed_count != null ? Number(row.failed_count) : undefined,
  };
}

function dbToBulkEmailJobItem(row: any): BulkEmailJobItem {
  return {
    id: row.id,
    leadId: row.lead_id,
    leadName: row.lead_name,
    status: row.status as BulkEmailItemStatus,
    detail: row.detail,
    updatedAt: row.updated_at,
  };
}

/** Creates the job row and one queued item per lead — mirrors
 * useCreateBulkSmsJob exactly. The (not yet built) bulk-email-dispatcher
 * picks up any 'running' job on its own once it exists; until then, jobs
 * created here simply sit queued, same as a bulk SMS job would if the SMS
 * dispatcher's cron were ever paused. */
export function useCreateBulkEmailJob() {
  const { profile } = useAuth();
  return useMutation({
    mutationFn: async ({ leads, config }: { leads: Lead[]; config: BulkEmailConfig }) => {
      if (!profile?.id) throw new Error('Not signed in.');
      const { data: job, error: jobErr } = await supabase
        .from('bulk_email_jobs')
        .insert({ user_id: profile.id, status: 'running', total: leads.length, config })
        .select()
        .single();
      if (jobErr) throw jobErr;

      if (leads.length) {
        const { error: itemsErr } = await supabase.from('bulk_email_job_items').insert(
          leads.map((l) => ({
            job_id: job.id,
            lead_id: l.id,
            lead_name: `${l.firstName} ${l.lastName}`.trim() || l.email || '',
            status: 'queued',
          })),
        );
        if (itemsErr) throw itemsErr;
      }

      return dbToBulkEmailJob(job);
    },
  });
}

export function useBulkEmailJob(jobId: string | undefined) {
  return useQuery({
    queryKey: ['bulk_email_job', jobId],
    queryFn: async () => {
      const { data, error } = await supabase.from('bulk_email_jobs').select('*').eq('id', jobId!).single();
      if (error) throw error;
      return dbToBulkEmailJob(data);
    },
    enabled: !!jobId,
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 1500 : false),
  });
}

export function useBulkEmailJobs() {
  return useQuery({
    queryKey: ['bulk_email_jobs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bulk_email_jobs_with_counts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []).map(dbToBulkEmailJob);
    },
  });
}

export function useDeleteBulkEmailJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase.from('bulk_email_jobs').delete().eq('id', jobId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bulk_email_jobs'] }),
  });
}

const ITEMS_PAGE_SIZE = 1000;

export function useBulkEmailJobItems(jobId: string | undefined, jobStatus: string | undefined) {
  return useQuery({
    queryKey: ['bulk_email_job_items', jobId],
    queryFn: async () => {
      const rows: any[] = [];
      for (let from = 0; ; from += ITEMS_PAGE_SIZE) {
        const { data, error } = await supabase
          .from('bulk_email_job_items')
          .select('*')
          .eq('job_id', jobId!)
          .order('id', { ascending: true })
          .range(from, from + ITEMS_PAGE_SIZE - 1);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < ITEMS_PAGE_SIZE) break;
      }
      rows.sort((a, b) => (a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : 0));
      return rows.map(dbToBulkEmailJobItem);
    },
    enabled: !!jobId,
    refetchInterval: jobStatus === 'running' ? 1500 : false,
  });
}

export function usePauseBulkEmailJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase.rpc('pause_bulk_email_job', { p_job_id: jobId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bulk_email_job'] });
      qc.invalidateQueries({ queryKey: ['bulk_email_jobs'] });
    },
  });
}

export function useResumeBulkEmailJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase.rpc('resume_bulk_email_job', { p_job_id: jobId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bulk_email_job'] });
      qc.invalidateQueries({ queryKey: ['bulk_email_jobs'] });
    },
  });
}
