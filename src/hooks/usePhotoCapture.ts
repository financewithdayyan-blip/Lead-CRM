import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

/** Creates a fresh capture-session row for this lead and hands back its
 *  token — the agent's own authenticated insert, gated by RLS to leads
 *  they own (see 0187's photo_capture_sessions_insert policy). Each click
 *  makes a new link/session rather than reusing one, same as a packet's
 *  own slug never being recycled — keeps a stale, already-sent link from
 *  silently changing status underneath an older text message. */
export function useCreateCaptureSession() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (leadId: string) => {
      const { data, error } = await supabase
        .from('photo_capture_sessions')
        .insert({ lead_id: leadId, created_by: session!.user.id })
        .select('id, token')
        .single();
      if (error) throw error;
      return data as { id: string; token: string };
    },
    onSuccess: (_data, leadId) => qc.invalidateQueries({ queryKey: ['capture_sessions', leadId] }),
  });
}

export interface CaptureSession {
  id: string;
  status: 'pending' | 'in_progress' | 'completed';
  photosCount: number;
  createdAt: string;
}

/** Recent capture-session history for a lead — lets the Property tab show
 *  "last requested 2 days ago, not completed yet" instead of the agent
 *  wondering whether a link already went out. */
export function useCaptureSessions(leadId: string | undefined) {
  return useQuery({
    queryKey: ['capture_sessions', leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('photo_capture_sessions')
        .select('id, status, photos_count, created_at')
        .eq('lead_id', leadId!)
        .order('created_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        status: r.status,
        photosCount: r.photos_count,
        createdAt: r.created_at,
      })) as CaptureSession[];
    },
    enabled: !!leadId,
  });
}

// ---- Public side (CapturePage, no auth session) --------------------------

export interface PublicCaptureSession {
  status: 'pending' | 'in_progress' | 'completed';
  photosCount: number;
  firstName: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  beds: number | null;
  baths: number | null;
}

export function usePublicCaptureSession(token: string | undefined) {
  return useQuery({
    queryKey: ['public_capture_session', token],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_capture_session', { p_token: token });
      if (error) throw error;
      return (data as PublicCaptureSession | null) ?? null;
    },
    enabled: !!token,
    retry: false,
  });
}

export function useSubmitCapturePhoto() {
  return useMutation({
    mutationFn: async ({ token, category, blob }: { token: string; category: string; blob: Blob }) => {
      const form = new FormData();
      form.append('token', token);
      form.append('category', category);
      form.append('image', blob, `${category}.jpg`);
      const { data, error } = await supabase.functions.invoke('submit-capture-photo', { body: form });
      if (error) {
        const errBody = await error.context?.json?.().catch(() => null);
        throw new Error(errBody?.error || error.message);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
  });
}

export function useCompleteCaptureSession() {
  return useMutation({
    mutationFn: async (token: string) => {
      const { data, error } = await supabase.functions.invoke('complete-capture-session', { body: { token } });
      if (error) {
        const errBody = await error.context?.json?.().catch(() => null);
        throw new Error(errBody?.error || error.message);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
  });
}
