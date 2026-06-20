import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { dbToProfile } from '@/lib/mappers';
import { useAuth } from '@/contexts/AuthContext';
import type { Profile, TeamMember } from '@/types/domain';

export function useTeamMembers() {
  const { session } = useAuth();
  const ownerId = session?.user.id;
  return useQuery({
    queryKey: ['team_members', ownerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_members')
        .select('id, owner_id, member_id, added_at, member:profiles!team_members_member_id_fkey(*)')
        .eq('owner_id', ownerId);
      if (error) throw error;
      return data.map(
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

export function useFindProfileByCode() {
  return useMutation({
    mutationFn: async (code: string) => {
      const { data, error } = await supabase
        .from('profile_directory')
        .select('*')
        .ilike('user_code', code.trim())
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; user_code: string; caller_name: string | null; email: string } | null;
    },
  });
}

export function useAddTeamMember() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase.from('team_members').insert({ owner_id: session!.user.id, member_id: memberId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team_members'] }),
  });
}

export function useRemoveTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('team_members').delete().eq('id', id);
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
