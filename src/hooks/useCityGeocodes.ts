import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface CityGeocode {
  cityKey: string;
  stateKey: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
}

export const cityGeoKey = (city: string, state: string) => `${city.trim().toLowerCase()}|${state.trim().toUpperCase()}`;

/** Every cached city -> lat/lng, shared across all users — see 0123_city_geocodes.sql. */
export function useCityGeocodes() {
  return useQuery({
    queryKey: ['city_geocodes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('city_geocodes').select('*');
      if (error) throw error;
      const byKey = new Map<string, CityGeocode>();
      for (const r of data) {
        byKey.set(cityGeoKey(r.city_key, r.state_key), {
          cityKey: r.city_key,
          stateKey: r.state_key,
          city: r.city,
          state: r.state,
          lat: Number(r.lat),
          lng: Number(r.lng),
        });
      }
      return byKey;
    },
    staleTime: 60 * 60_000, // city coordinates never meaningfully change
  });
}

/** Called from the map when it hits a city with no cached geocode yet —
 * writes the result back so every future dashboard load (any user) has it
 * without re-hitting the free geocoders again. */
export function useUpsertCityGeocode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: { city: string; state: string; lat: number; lng: number }) => {
      const { error } = await supabase.from('city_geocodes').upsert(
        {
          city_key: row.city.trim().toLowerCase(),
          state_key: row.state.trim().toUpperCase(),
          city: row.city.trim(),
          state: row.state.trim().toUpperCase(),
          lat: row.lat,
          lng: row.lng,
        },
        { onConflict: 'city_key,state_key' },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['city_geocodes'] }),
  });
}
