import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { dbToLeadShare } from '@/lib/mappers';
import { useAuth } from '@/contexts/AuthContext';
import type { LeadStage } from '@/types/domain';

function invalidateAfterTransfer(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['lead_shares'] });
  qc.invalidateQueries({ queryKey: ['leads'] });
  qc.invalidateQueries({ queryKey: ['tasks'] });
}

export function useMyPendingShareForLead(leadId: string | undefined) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['lead_shares', 'mine', leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lead_shares')
        .select('*')
        .eq('lead_id', leadId)
        .eq('from_user_id', session!.user.id)
        .eq('status', 'pending')
        .maybeSingle();
      if (error) throw error;
      return data ? dbToLeadShare(data) : null;
    },
    enabled: !!leadId && !!session?.user.id,
  });
}

export function useShareLead() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadId, stage }: { leadId: string; stage: LeadStage }) => {
      const { error } = await supabase
        .from('lead_shares')
        .insert({ lead_id: leadId, from_user_id: session!.user.id, stage_at_share: stage });
      if (error) throw error;
    },
    onSuccess: (_, { leadId }) => qc.invalidateQueries({ queryKey: ['lead_shares', 'mine', leadId] }),
  });
}

export function usePendingLeadShares() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ['lead_shares', 'pending'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lead_shares')
        .select('*, lead:leads(first_name, last_name), from_profile:profiles!lead_shares_from_user_id_fkey(full_name, email)')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data.map((row: any) => ({
        ...dbToLeadShare(row),
        leadName: `${row.lead?.first_name ?? ''} ${row.lead?.last_name ?? ''}`.trim() || 'Untitled lead',
        fromName: row.from_profile?.full_name || row.from_profile?.email || 'A team member',
      }));
    },
    enabled: profile?.role === 'admin',
  });
}

export function useAcceptLeadShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (shareId: string) => {
      const { error } = await supabase.rpc('accept_lead_share', { p_share_id: shareId });
      if (error) throw error;
    },
    onSuccess: () => invalidateAfterTransfer(qc),
  });
}

export function useDeclineLeadShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (shareId: string) => {
      const { error } = await supabase
        .from('lead_shares')
        .update({ status: 'declined', resolved_at: new Date().toISOString() })
        .eq('id', shareId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lead_shares'] }),
  });
}

export function useTransferLeadToAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (leadId: string) => {
      const { error } = await supabase.rpc('transfer_lead_to_admin', { p_lead_id: leadId });
      if (error) throw error;
    },
    onSuccess: () => invalidateAfterTransfer(qc),
  });
}
