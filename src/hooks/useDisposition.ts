import { useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

export interface BuyerDealRecipient {
  id: string;
  sendId: string;
  packetId: string;
  leadId: string;
  committedPrice: number | null;
  committedAt: string | null;
  assignmentSignedAt: string | null;
  sentToTcAt: string | null;
  closedAt: string | null;
  createdAt: string;
}

/** A buyer's most recent "sent a deal packet to them" record — backs the
 *  Disposition Messages tab's deal panel. Only the most recent send is
 *  shown; a buyer who received several packets over time only ever sees
 *  the latest one here (matching "what are we actively working with this
 *  buyer on right now", not a full history). */
export function useLatestBuyerDealRecipient(buyerId: string | undefined) {
  return useQuery({
    queryKey: ['buyer_deal_recipient', buyerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('disposition_send_recipients')
        .select('id, send_id, committed_price, committed_at, assignment_signed_at, sent_to_tc_at, closed_at, created_at, disposition_sends(packet_id, lead_id)')
        .eq('buyer_id', buyerId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const send = data.disposition_sends as unknown as { packet_id: string; lead_id: string } | null;
      if (!send) return null;
      return {
        id: data.id,
        sendId: data.send_id,
        packetId: send.packet_id,
        leadId: send.lead_id,
        committedPrice: data.committed_price != null ? Number(data.committed_price) : null,
        committedAt: data.committed_at,
        assignmentSignedAt: data.assignment_signed_at,
        sentToTcAt: data.sent_to_tc_at,
        closedAt: data.closed_at,
        createdAt: data.created_at,
      } as BuyerDealRecipient;
    },
    enabled: !!buyerId,
  });
}

export type DealStage = 'committed' | 'assignment_signed' | 'sent_to_tc' | 'closed';

/** Manually marks a deal-progress stage — there's no real e-sign/TC
 *  integration behind this yet (see migration 0193's own note), so this is
 *  an admin recording a real decision, not automation inferring one. */
export function useMarkDealStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ recipientId, stage, price }: { recipientId: string; stage: DealStage; price?: number }) => {
      const column: Record<DealStage, string> = {
        committed: 'committed_at',
        assignment_signed: 'assignment_signed_at',
        sent_to_tc: 'sent_to_tc_at',
        closed: 'closed_at',
      };
      const patch: Record<string, unknown> = { [column[stage]]: new Date().toISOString() };
      if (stage === 'committed' && price != null) patch.committed_price = price;
      const { error } = await supabase.from('disposition_send_recipients').update(patch).eq('id', recipientId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['buyer_deal_recipient'] }),
  });
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash_buyers'] });
      qc.invalidateQueries({ queryKey: ['buyer_deal_recipient'] });
    },
  });
}
