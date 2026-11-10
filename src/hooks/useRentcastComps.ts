import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface RentcastComp {
  id: string;
  address: string | null;
  price: number | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  lotSize: number | null;
  lat: number;
  lng: number;
  distanceMiles: number | null;
  date: string | null;
  status: string | null;
}

export interface RentcastCompsResult {
  subject: { lat: number; lng: number };
  listingComps: RentcastComp[];
  soldComps: RentcastComp[];
  rentalComps: RentcastComp[];
}

export interface RentcastCompsParams {
  address: string;
  radiusMiles?: number;
  saleDateRangeDays?: number;
}

/** RentCast bills per call, so this is a plain mutation triggered once per
 *  modal-open (see CompPickerModal) rather than a cached query re-fetched
 *  on every render — the modal itself holds the one result in local state
 *  and only re-invokes this on an explicit "Refresh"/filter-change. */
export function useRentcastComps() {
  return useMutation({
    mutationFn: async (params: RentcastCompsParams) => {
      const { data, error } = await supabase.functions.invoke('fetch-rentcast-comps', { body: params });
      if (error) {
        const errBody = await error.context?.json?.().catch(() => null);
        throw new Error(errBody?.error || error.message);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as RentcastCompsResult;
    },
  });
}
