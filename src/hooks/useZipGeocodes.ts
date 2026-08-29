import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface ZipGeocode {
  zip5: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
}

/** Every cached zip5 -> lat/lng, shared across all users — see
 * 0124_zip_geocodes.sql. Backs the City Performance map's zip-level
 * drill-down. */
export function useZipGeocodes() {
  return useQuery({
    queryKey: ['zip_geocodes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('zip_geocodes').select('*');
      if (error) throw error;
      const byZip = new Map<string, ZipGeocode>();
      for (const r of data) {
        byZip.set(r.zip5, { zip5: r.zip5, city: r.city, state: r.state, lat: Number(r.lat), lng: Number(r.lng) });
      }
      return byZip;
    },
    staleTime: 60 * 60_000, // zip coordinates never meaningfully change
  });
}

/** Called from the map when it hits a zip with no cached geocode yet. Unlike
 * cities (resolved live against free geocoders), a brand-new zip has no
 * client-side resolution path — this just lets an admin add one by hand if
 * it ever comes up; the real backfill was a one-off offline lookup. */
export function useUpsertZipGeocode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: { zip5: string; city: string; state: string; lat: number; lng: number }) => {
      const { error } = await supabase
        .from('zip_geocodes')
        .upsert({ zip5: row.zip5, city: row.city, state: row.state.toUpperCase(), lat: row.lat, lng: row.lng }, { onConflict: 'zip5' });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['zip_geocodes'] }),
  });
}
