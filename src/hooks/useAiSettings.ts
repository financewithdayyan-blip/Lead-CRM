import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

/** Global on/off for the whole auto-reply feature, separate from any lead's own pause flag. Default on. */
export function useAiSettings() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['ai_settings', session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_settings')
        .select('auto_reply_enabled')
        .eq('user_id', session!.user.id)
        .maybeSingle();
      if (error) throw error;
      // No row yet means the toggle has never been touched — defaults on,
      // matching what the ai-reply function itself assumes when it finds
      // nothing (see sms-webhook's own "missing row -> enabled" comment).
      return { autoReplyEnabled: data?.auto_reply_enabled ?? true };
    },
    enabled: !!session?.user.id,
  });
}

export function useSetAiEnabled() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await supabase
        .from('ai_settings')
        .upsert(
          { user_id: session!.user.id, auto_reply_enabled: enabled, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' },
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai_settings'] }),
  });
}
