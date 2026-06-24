import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { dbToTag } from '@/lib/mappers';
import { useAuth } from '@/contexts/AuthContext';

const TAG_COLORS = [
  { bg: 'rgba(0,207,180,0.14)', text: '#2ddfc8' },
  { bg: 'rgba(176,138,250,0.14)', text: '#b08afa' },
  { bg: 'rgba(255,140,75,0.14)', text: '#ff8c4b' },
  { bg: 'rgba(34,201,123,0.14)', text: '#22c97b' },
  { bg: 'rgba(240,82,82,0.14)', text: '#f05252' },
  { bg: 'rgba(245,165,36,0.14)', text: '#f5a524' },
];

export function nextTagColor(existingCount: number) {
  return TAG_COLORS[existingCount % TAG_COLORS.length];
}

export function useTags(targetUserId?: string) {
  const { session } = useAuth();
  const userId = targetUserId ?? session?.user.id;
  return useQuery({
    queryKey: ['tags', userId],
    queryFn: async () => {
      const { data, error } = await supabase.from('tags').select('*').eq('user_id', userId).order('name');
      if (error) throw error;
      return data.map(dbToTag);
    },
    enabled: !!userId,
  });
}

export function useCreateTag() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      name,
      colorBg,
      colorText,
      userId,
    }: {
      name: string;
      colorBg: string;
      colorText: string;
      userId?: string;
    }) => {
      const { data, error } = await supabase
        .from('tags')
        .insert({ user_id: userId ?? session!.user.id, name, color_bg: colorBg, color_text: colorText })
        .select('*')
        .single();
      if (error) throw error;
      return dbToTag(data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }),
  });
}

export function useUpdateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name, colorBg, colorText }: { id: string; name: string; colorBg: string; colorText: string }) => {
      const { error } = await supabase.from('tags').update({ name, color_bg: colorBg, color_text: colorText }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }),
  });
}

export function useDeleteTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('tags').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tags'] });
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}
