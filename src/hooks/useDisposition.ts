import { useEffect, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { geocodeAddress } from '@/lib/geocode';
import { useCityGeocodes, useUpsertCityGeocode, cityGeoKey } from '@/hooks/useCityGeocodes';
import { normalizeStateToCode } from '@/data/usGeo';
import type { BuyerType, CashBuyer, DispositionChannel } from '@/types/domain';

export interface BuyerCityPin {
  buyerId: string;
  buyerName: string;
  buyerTypes: BuyerType[];
  city: string;
  state: string;
  lat: number;
  lng: number;
}

export interface StateBuyerCount {
  state: string;
  count: number;
}

/** Expands every active buyer into one pin per (city, its one associated
 *  state), geocoded via the shared city_geocodes cache the dashboard map
 *  already maintains — missing ones are resolved on demand and written
 *  back, same auto-geocode effect CityPerformanceMap uses. A buyer with no
 *  cities, or with cities but an ambiguous (0 or 2+) state count, is
 *  counted in state totals below but not plotted as a city pin — plotting
 *  would require guessing which of several states a city belongs to, and a
 *  wrong guess is worse than a buyer simply not appearing on the city map. */
export function useBuyerMarketMap(buyers: CashBuyer[]) {
  const { data: cityGeocodes = new Map() } = useCityGeocodes();
  const upsertCityGeocode = useUpsertCityGeocode();

  const active = useMemo(() => buyers.filter((b) => b.status === 'active'), [buyers]);

  const stateCounts = useMemo<StateBuyerCount[]>(() => {
    const counts = new Map<string, number>();
    for (const b of active) {
      const states = b.marketStates.length > 0 ? b.marketStates : [];
      for (const s of states) {
        const code = normalizeStateToCode(s);
        if (!code) continue;
        counts.set(code, (counts.get(code) ?? 0) + 1);
      }
    }
    return [...counts.entries()].map(([state, count]) => ({ state, count })).sort((a, b) => b.count - a.count);
  }, [active]);

  const cityBuyerPairs = useMemo(() => {
    const pairs: Array<{ buyer: CashBuyer; city: string; state: string }> = [];
    for (const b of active) {
      if (b.marketCities.length === 0 || b.marketStates.length !== 1) continue;
      const stateCode = normalizeStateToCode(b.marketStates[0]);
      if (!stateCode) continue;
      for (const city of b.marketCities) pairs.push({ buyer: b, city, state: stateCode });
    }
    return pairs;
  }, [active]);

  useEffect(() => {
    const missing = [...new Map(cityBuyerPairs.map((p) => [cityGeoKey(p.city, p.state), p])).values()]
      .filter((p) => !cityGeocodes.has(cityGeoKey(p.city, p.state)))
      .slice(0, 25);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const p of missing) {
        if (cancelled) return;
        const point = await geocodeAddress(`${p.city}, ${p.state}`).catch(() => null);
        if (point && !cancelled) upsertCityGeocode.mutate({ city: p.city, state: p.state, lat: point.lat, lng: point.lng });
        await new Promise((r) => setTimeout(r, 1100));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(cityBuyerPairs.map((p) => cityGeoKey(p.city, p.state))), cityGeocodes.size]);

  const pins = useMemo<BuyerCityPin[]>(() => {
    return cityBuyerPairs
      .map(({ buyer, city, state }) => {
        const geo = cityGeocodes.get(cityGeoKey(city, state));
        if (!geo) return null;
        return { buyerId: buyer.id, buyerName: buyer.name, buyerTypes: buyer.buyerTypes, city, state, lat: geo.lat, lng: geo.lng };
      })
      .filter((p): p is BuyerCityPin => p !== null);
  }, [cityBuyerPairs, cityGeocodes]);

  return { stateCounts, pins, activeBuyers: active };
}

export function useSendDispositionPacket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { packetId: string; buyerIds: string[]; channel: DispositionChannel; message: string; subject?: string }) => {
      const { data, error } = await supabase.functions.invoke('send-disposition-packet', { body: input });
      if (error) {
        const errBody = await error.context?.json?.().catch(() => null);
        throw new Error(errBody?.error || error.message);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { ok: true; sendId: string; sent: number; failed: number };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cash_buyers'] }),
  });
}
