import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface WebLead {
  id: string;
  createdAt: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  propertyAddress: string;
  situation: string | null;
  timeline: string | null;
  notes: string | null;
  isRead: boolean;
}

function rowToWebLead(row: Record<string, unknown>): WebLead {
  return {
    id: row.id as string,
    createdAt: row.created_at as string,
    firstName: row.first_name as string,
    lastName: row.last_name as string,
    phone: row.phone as string,
    email: row.email as string | null,
    propertyAddress: row.property_address as string,
    situation: row.situation as string | null,
    timeline: row.timeline as string | null,
    notes: row.notes as string | null,
    isRead: row.is_read as boolean,
  };
}

export function useWebLeads(enabled: boolean) {
  return useQuery({
    queryKey: ['web-leads'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('web_leads')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []).map(rowToWebLead);
    },
    enabled,
    refetchInterval: 60_000,
  });
}

export function useMarkWebLeadRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('web_leads')
        .update({ is_read: true })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['web-leads'] }),
  });
}

export function useMarkAllWebLeadsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('web_leads')
        .update({ is_read: true })
        .eq('is_read', false);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['web-leads'] }),
  });
}
