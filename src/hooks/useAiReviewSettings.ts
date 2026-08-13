import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

/** Whether the nightly ai-reply-review self-review job should run at all —
 * checked by that function itself before it does any work, so turning this
 * off stops the (Opus 5) API cost entirely rather than just hiding a report. */
export function useAiReviewSettings() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['ai_reply_review_settings', session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_reply_review_settings')
        .select('enabled')
        .eq('user_id', session!.user.id)
        .maybeSingle();
      if (error) throw error;
      return { enabled: data?.enabled ?? true };
    },
    enabled: !!session?.user.id,
  });
}

export function useSaveAiReviewSettings() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await supabase.from('ai_reply_review_settings').upsert(
        { user_id: session!.user.id, enabled, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai_reply_review_settings'] }),
  });
}
