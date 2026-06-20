import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { dbToCallLogEntry } from '@/lib/mappers';
import { useAuth } from '@/contexts/AuthContext';
import type { CallLogEntry, LeadStatus } from '@/types/domain';

const CALL_LOG_SELECT = '*, call_log_tags(tag_id)';

export function useCallLog(targetUserId?: string) {
  const { session } = useAuth();
  const userId = targetUserId ?? session?.user.id;
  return useQuery({
    queryKey: ['call_log', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('call_log')
        .select(CALL_LOG_SELECT)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data.map(dbToCallLogEntry);
    },
    enabled: !!userId,
  });
}

export function useLogCall() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entry: Partial<CallLogEntry> & { status: LeadStatus; tagIds?: string[] }) => {
      const { data, error } = await supabase
        .from('call_log')
        .insert({
          user_id: session!.user.id,
          lead_id: entry.leadId ?? null,
          lead_num: entry.leadNum ?? null,
          name: entry.name ?? '',
          phone: entry.phone ?? '',
          address: entry.address ?? null,
          status: entry.status,
          rating: entry.rating ?? 0,
          note: entry.note ?? null,
        })
        .select('id')
        .single();
      if (error) throw error;
      if (entry.tagIds?.length) {
        await supabase.from('call_log_tags').insert(entry.tagIds.map((tagId) => ({ call_log_id: data.id, tag_id: tagId })));
      }
      return data.id as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['call_log'] });
      qc.invalidateQueries({ queryKey: ['daily_stats'] });
    },
  });
}
