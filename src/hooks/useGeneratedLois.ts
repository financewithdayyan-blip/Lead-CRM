import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export interface LeadOption {
  id: string;
  leadNum: number | null;
  firstName: string;
  lastName: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

/**
 * Every lead the admin can see, across every caller's own leads too — not
 * just the admin's own — since a Letter of Intent is generated for whichever
 * lead is furthest along, and that's very often a caller-owned lead. No
 * .eq('user_id', ...) filter at all: RLS's own is_team_overseer clause
 * already scopes this correctly for whoever is authenticated.
 */
export function useLeadsForDocs() {
  return useQuery({
    queryKey: ['leads_for_docs'],
    queryFn: async () => {
      const PAGE = 1000;
      const { count, error: countError } = await supabase
        .from('leads')
        .select('id', { count: 'exact', head: true });
      if (countError) throw countError;
      if (!count) return [] as LeadOption[];

      const pages = await Promise.all(
        Array.from({ length: Math.ceil(count / PAGE) }, async (_, i) => {
          const { data, error } = await supabase
            .from('leads')
            .select('id, lead_num, first_name, last_name, phone, address, city, state, zip')
            .order('lead_num', { ascending: true })
            .range(i * PAGE, i * PAGE + PAGE - 1);
          if (error) throw error;
          return data;
        }),
      );

      return pages.flat().map(
        (r): LeadOption => ({
          id: r.id,
          leadNum: r.lead_num,
          firstName: r.first_name,
          lastName: r.last_name,
          phone: r.phone,
          address: r.address,
          city: r.city,
          state: r.state,
          zip: r.zip,
        }),
      );
    },
  });
}

export interface GeneratedLoi {
  id: string;
  leadId: string;
  slug: string;
  status: 'active' | 'archived';
  body: string;
  leadName: string | null;
  propertyAddress: string | null;
  createdAt: string;
}

function fromRow(r: any): GeneratedLoi {
  return {
    id: r.id,
    leadId: r.lead_id,
    slug: r.slug,
    status: r.status,
    body: r.body,
    leadName: r.lead_name,
    propertyAddress: r.property_address,
    createdAt: r.created_at,
  };
}

export function useGeneratedLois() {
  return useQuery({
    queryKey: ['generated_lois'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('generated_lois')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data.map(fromRow);
    },
  });
}

export function useGenerateLoi() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      leadId: string;
      templateId: string | null;
      body: string;
      leadName: string;
      propertyAddress: string;
    }) => {
      const { data, error } = await supabase
        .from('generated_lois')
        .insert({
          lead_id: input.leadId,
          template_id: input.templateId,
          body: input.body,
          lead_name: input.leadName,
          property_address: input.propertyAddress,
          created_by: session!.user.id,
        })
        .select('*')
        .single();
      if (error) throw error;
      return fromRow(data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['generated_lois'] }),
  });
}

export function useArchiveGeneratedLoi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'active' | 'archived' }) => {
      const { error } = await supabase.from('generated_lois').update({ status }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['generated_lois'] }),
  });
}

export function useDeleteGeneratedLoi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('generated_lois').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['generated_lois'] }),
  });
}

export interface PublicLoi {
  body: string;
  leadName: string | null;
  propertyAddress: string | null;
  createdAt: string;
}

export function usePublicLoi(slug: string | undefined) {
  return useQuery({
    queryKey: ['public_loi', slug],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_public_loi', { p_slug: slug });
      if (error) throw error;
      return (data as PublicLoi | null) ?? null;
    },
    enabled: !!slug,
    staleTime: 60_000,
    retry: false,
  });
}
