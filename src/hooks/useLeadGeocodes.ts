import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface LeadGeocode {
  leadId: string;
  lat: number;
  lng: number;
}

/** Every cached lead -> lat/lng, shared across all users — see
 * 0132_lead_geocodes.sql. Backs CityZipMap's under-contract property pins. */
export function useLeadGeocodes() {
  return useQuery({
    queryKey: ['lead_geocodes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('lead_geocodes').select('*');
      if (error) throw error;
      const byLeadId = new Map<string, LeadGeocode>();
      for (const r of data) {
        byLeadId.set(r.lead_id, { leadId: r.lead_id, lat: Number(r.lat), lng: Number(r.lng) });
      }
      return byLeadId;
    },
    staleTime: 60 * 60_000, // a property's coordinates never meaningfully change
  });
}

/** Called from the map when it hits an under-contract lead with no cached
 * geocode yet — writes the result back so every future dashboard load (any
 * user) has it without re-hitting the free geocoders again. */
export function useUpsertLeadGeocode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: { leadId: string; lat: number; lng: number }) => {
      const { error } = await supabase
        .from('lead_geocodes')
        .upsert({ lead_id: row.leadId, lat: row.lat, lng: row.lng }, { onConflict: 'lead_id' });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lead_geocodes'] }),
  });
}
