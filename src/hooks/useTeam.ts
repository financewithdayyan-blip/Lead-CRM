import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { dbToProfile, dbToTeamInvite } from '@/lib/mappers';
import { useAuth } from '@/contexts/AuthContext';
import type { Profile, Role, TeamMember } from '@/types/domain';

export function useTeamMembers() {
  const { session, profile } = useAuth();
  const ownerId = session?.user.id;
  const isAdmin = profile?.role === 'admin';
  return useQuery({
    queryKey: ['team_members', ownerId, isAdmin],
    queryFn: async () => {
      // Admins see the whole shared team roster (RLS allows it after migration 0016).
      // Callers only need their own row (used by Sidebar ViewingPullUp — but callers
      // don't see that component anyway, so this is just a safety guard).
      let query = supabase
        .from('team_members')
        .select('id, owner_id, member_id, added_at, member:profiles!team_members_member_id_fkey(*)');

      if (!isAdmin) {
        query = query.eq('owner_id', ownerId);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Deduplicate by member_id in case a caller was invited by multiple admins.
      const seen = new Set<string>();
      return data
        .filter((row: any) => {
          if (seen.has(row.member_id)) return false;
          seen.add(row.member_id);
          return true;
        })
        .map(
          (row: any): TeamMember => ({
            id: row.id,
            ownerId: row.owner_id,
            memberId: row.member_id,
            addedAt: row.added_at,
            member: dbToProfile(row.member),
          }),
        );
    },
    enabled: !!ownerId,
  });
}

export function useRemoveTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    // Delete by member_id so all rows for that caller are removed regardless of
    // which admin originally invited them.
    mutationFn: async (memberId: string) => {
      const { error } = await supabase.from('team_members').delete().eq('member_id', memberId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team_members'] }),
  });
}

export function useUpdateMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, role }: { id: string; role: Profile['role'] }) => {
      const { error } = await supabase.from('profiles').update({ role }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team_members'] }),
  });
}

export function useUpdateMemberGoals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dailyGoal, monthlyGoal }: { id: string; dailyGoal: number; monthlyGoal: number }) => {
      const { error } = await supabase.from('profiles').update({ daily_goal: dailyGoal, monthly_goal: monthlyGoal }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team_members'] }),
  });
}

export function useTeamInvites() {
  const { session } = useAuth();
  const ownerId = session?.user.id;
  return useQuery({
    queryKey: ['team_invites', ownerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_invites')
        .select('*')
        .eq('owner_id', ownerId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data.map(dbToTeamInvite);
    },
    enabled: !!ownerId,
  });
}

export function useSendInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ email, role }: { email: string; role: Role }) => {
      const { data, error } = await supabase.functions.invoke('invite-user', {
        body: { email: email.trim(), role },
      });
      if (error) {
        // supabase-js's FunctionsHttpError.message is just a generic
        // "non-2xx status code" - the actual reason is in the response body.
        const body = await error.context?.json?.().catch(() => null);
        throw new Error(body?.error || error.message);
      }
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team_invites'] }),
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('team_invites').update({ status: 'revoked' }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team_invites'] }),
  });
}
