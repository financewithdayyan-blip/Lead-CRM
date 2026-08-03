import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export interface SmsBulkTemplateRow {
  id: string;
  tagId: string | null;
  body: string;
  updatedAt: string;
}

export function useSmsTemplates() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['sms_bulk_templates', session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sms_bulk_templates')
        .select('id, tag_id, body, updated_at')
        .eq('user_id', session!.user.id);
      if (error) throw error;
      return data.map(
        (r): SmsBulkTemplateRow => ({ id: r.id, tagId: r.tag_id, body: r.body, updatedAt: r.updated_at }),
      );
    },
    enabled: !!session?.user.id,
  });
}

export function useSaveSmsTemplate() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ tagId, body }: { tagId: string | null; body: string }) => {
      const userId = session!.user.id;

      // Same reasoning as ai_reply_config's own save: NULL never conflicts
      // with NULL, so the Default row (tag_id IS NULL) has to be found and
      // updated by hand rather than relying on upsert's onConflict target.
      if (tagId === null) {
        const { data: existing } = await supabase
          .from('sms_bulk_templates')
          .select('id')
          .eq('user_id', userId)
          .is('tag_id', null)
          .maybeSingle();

        const { error } = existing
          ? await supabase
              .from('sms_bulk_templates')
              .update({ body, updated_at: new Date().toISOString() })
              .eq('id', existing.id)
          : await supabase.from('sms_bulk_templates').insert({ user_id: userId, tag_id: null, body });

        if (error) throw error;
        return;
      }

      const { error } = await supabase
        .from('sms_bulk_templates')
        .upsert(
          { user_id: userId, tag_id: tagId, body, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,tag_id' },
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sms_bulk_templates'] }),
  });
}
