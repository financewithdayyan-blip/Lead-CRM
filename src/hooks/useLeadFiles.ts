import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

/** One signed URL per path in a single call, for rendering a whole list of
 * thumbnails at once — the bucket is private, so there's no public URL to
 * fall back to and each row would otherwise need its own round trip. */
export function useSignedFileUrls(storagePaths: string[]) {
  const key = storagePaths.join('|');
  return useQuery({
    queryKey: ['lead-file-signed-urls', key],
    queryFn: async () => {
      const { data, error } = await supabase.storage.from('lead-files').createSignedUrls(storagePaths, 60 * 60);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const row of data ?? []) {
        if (row.signedUrl && row.path) map[row.path] = row.signedUrl;
      }
      return map;
    },
    enabled: storagePaths.length > 0,
    staleTime: 55 * 60 * 1000,
  });
}
