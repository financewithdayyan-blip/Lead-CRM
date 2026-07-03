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
        .is('initiated_by', null) // only caller-initiated shares; admin-initiated go to receiving caller
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

/** Admin shares a lead from its current owner to another caller. */
export function useAdminShareLeadToCaller() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadId, toUserId }: { leadId: string; toUserId: string }) => {
      const { error } = await supabase.rpc('admin_share_lead_to_caller', {
        p_lead_id: leadId,
        p_to_user_id: toUserId,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateAfterTransfer(qc),
  });
}

/** Fetches pending admin-initiated shares targeting the current caller. */
export function usePendingIncomingShares() {
  const { session, profile } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ['lead_shares', 'incoming', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lead_shares')
        .select(
          '*, lead:leads(first_name, last_name), from_profile:profiles!lead_shares_from_user_id_fkey(full_name, email), to_profile:profiles!lead_shares_to_user_id_fkey(full_name, email)',
        )
        .eq('to_user_id', userId)
        .eq('status', 'pending')
        .not('initiated_by', 'is', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data.map((row: any) => ({
        ...dbToLeadShare(row),
        leadId: row.lead_id,
        leadName: `${row.lead?.first_name ?? ''} ${row.lead?.last_name ?? ''}`.trim() || 'Untitled lead',
        fromName: row.from_profile?.full_name || row.from_profile?.email || 'A team member',
        toName: row.to_profile?.full_name || row.to_profile?.email || 'You',
      }));
    },
    enabled: !!userId && profile?.role === 'caller',
  });
}

/** Receiving caller accepts an admin-initiated share. */
export function useAcceptAdminLeadShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (shareId: string) => {
      const { error } = await supabase.rpc('accept_admin_lead_share', { p_share_id: shareId });
      if (error) throw error;
    },
    onSuccess: () => invalidateAfterTransfer(qc),
  });
}

/** Receiving caller declines an admin-initiated share. */
export function useDeclineAdminLeadShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (shareId: string) => {
      const { error } = await supabase.rpc('decline_admin_lead_share', { p_share_id: shareId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lead_shares'] }),
  });
}

/** Maps leadId -> who shared it, for leads currently in my pipeline via an accepted share - powers the "Shared by" highlight. */
export function useReceivedLeadShares() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ['lead_shares', 'received', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lead_shares')
        .select('lead_id, from_profile:profiles!lead_shares_from_user_id_fkey(full_name, email)')
        .eq('to_user_id', userId)
        .eq('status', 'accepted');
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const row of data as any[]) {
        map[row.lead_id] = row.from_profile?.full_name || row.from_profile?.email || 'a teammate';
      }
      return map;
    },
    enabled: !!userId,
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
