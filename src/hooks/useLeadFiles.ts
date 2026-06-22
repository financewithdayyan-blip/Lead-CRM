import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export function useUploadLeadFile() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadId, file }: { leadId: string; file: File }) => {
      const userId = session!.user.id;
      const path = `${userId}/${leadId}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from('lead-files').upload(path, file);
      if (uploadError) throw uploadError;
      const { error } = await supabase
        .from('lead_files')
        .insert({ lead_id: leadId, user_id: userId, storage_path: path, file_name: file.name, file_type: file.type });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: ['lead', vars.leadId] }),
  });
}

export function useDeleteLeadFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, storagePath }: { id: string; storagePath: string; leadId: string }) => {
      await supabase.storage.from('lead-files').remove([storagePath]);
      const { error } = await supabase.from('lead_files').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: ['lead', vars.leadId] }),
  });
}

export function useSignedFileUrl() {
  return useMutation({
    mutationFn: async (storagePath: string) => {
      const { data, error } = await supabase.storage.from('lead-files').createSignedUrl(storagePath, 60 * 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}
